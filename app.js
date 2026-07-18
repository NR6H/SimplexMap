/* ═══════════════════════════════════════════════════════════════
   SimplexMap — frontend  (jQuery + Leaflet)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────

let myCallsign   = localStorage.getItem('myCallsign') || null;
let stations     = {};   // callsign → station object
let reports      = [];   // all reception_report objects
let markers      = {};   // callsign → L.marker
let lines        = {};   // 'A|B' sorted key → L.polyline
let enrollLatLng = null; // L.LatLng chosen during enroll
let enrollPin    = null; // temporary L.marker during enroll
let enrollMode   = false;
let reportTarget = null; // callsign being reported on
let selR         = 0;    // selected readability (1-5)
let selS         = 0;    // selected signal strength (1-9)
let sseSource    = null;
let lastSseSync  = null; // UTC string, updated as events arrive
let toastTimer   = null;

// ── Init ─────────────────────────────────────────────────────────────────────

$(function () {
    initMap();
    loadInitialData();
    bindUI();
});

// ── Map ──────────────────────────────────────────────────────────────────────

let map;

function initMap() {
    map = L.map('map', { zoomControl: true }).setView([38.5816, -121.4944], 10);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    map.on('click', onMapClick);
}

function onMapClick(e) {
    if (!enrollMode) return;
    setEnrollPin(e.latlng);
}

function setEnrollPin(latlng) {
    enrollLatLng = latlng;
    if (enrollPin) map.removeLayer(enrollPin);
    enrollPin = L.marker(latlng, { icon: makeIcon('#0ea5e9', '?'), draggable: true })
        .addTo(map)
        .bindTooltip('Your location — drag to adjust', { permanent: false });
    enrollPin.on('dragend', function (ev) {
        enrollLatLng = ev.target.getLatLng();
        updateLocationDisplay();
    });
    updateLocationDisplay();
}

function updateLocationDisplay() {
    if (!enrollLatLng) return;
    const txt = enrollLatLng.lat.toFixed(5) + ',  ' + enrollLatLng.lng.toFixed(5);
    $('#f-location-display').text(txt).addClass('set');
}

// ── Data loading ─────────────────────────────────────────────────────────────

function loadInitialData() {
    // Record "now" before fetching so SSE starts from just before the fetch,
    // preventing a gap where new data could arrive between the REST call and SSE.
    lastSseSync = utcNow();

    $.when(
        $.getJSON('api/stations.php'),
        $.getJSON('api/reports.php')
    ).done(function (stResp, rpResp) {
        const stList = stResp[0];
        const rpList = rpResp[0];

        stList.forEach(s => addOrUpdateStation(s, false));
        reports = rpList;
        updateAllLines();
        updateSidebar();
        connectSSE(lastSseSync);
    }).fail(function () {
        showToast('Could not connect to server. Retrying…');
        setTimeout(loadInitialData, 5000);
    });
}

// ── SSE ──────────────────────────────────────────────────────────────────────

function connectSSE(since) {
    if (sseSource) sseSource.close();

    const url = 'api/events.php?since=' + encodeURIComponent(since || utcNow());
    sseSource = new EventSource(url);

    sseSource.addEventListener('station', function (e) {
        lastSseSync = utcNow();
        addOrUpdateStation(JSON.parse(e.data), true);
    });

    sseSource.addEventListener('report', function (e) {
        lastSseSync = utcNow();
        const r = JSON.parse(e.data);
        // Avoid duplicates — the submitting tab already applied it via applyNewReport()
        if (!reports.find(x => String(x.id) === String(r.id))) {
            applyNewReport(r, true);
        }
    });

    sseSource.addEventListener('station_removed', function (e) {
        const cs = JSON.parse(e.data).callsign;
        removeStation(cs);
        if (cs === myCallsign) {
            myCallsign = null;
            localStorage.removeItem('myCallsign');
            renderMyStationBar();
            showToast('Your station (' + cs + ') was removed due to inactivity. Please re-enroll.');
        }
    });

    sseSource.onerror = function () {
        sseSource.close();
        setTimeout(function () { connectSSE(lastSseSync || utcNow()); }, 5000);
    };
}

// ── Apply a new report to local state ────────────────────────────────────────
// Called immediately after a successful POST (same tab) AND from the SSE
// handler (other tabs). fromSSE=true shows the arrival toast.

function applyNewReport(r, fromSSE) {
    reports.push(r);

    // Redraw the line between this pair
    updatePairLine(r.reporter, r.target);

    // Refresh marker colours (target colour is driven by reports-about-it)
    if (markers[r.target])   markers[r.target].setIcon(makeStationIcon(r.target));
    if (markers[r.reporter]) markers[r.reporter].setIcon(makeStationIcon(r.reporter));

    // Refresh popup content for both stations (handles open popups live)
    refreshPopup(r.reporter);
    refreshPopup(r.target);

    // Rebuild sidebar so signal badges update
    updateSidebar();

    if (fromSSE) {
        showToast(r.reporter + ' → ' + r.target + ': R' + r.readability + '/S' + r.signal_strength);
    }
}

// ── Station management ───────────────────────────────────────────────────────

function addOrUpdateStation(s, fromSSE) {
    const isNew = !stations[s.callsign];
    stations[s.callsign] = s;

    if (markers[s.callsign]) {
        markers[s.callsign].setLatLng([s.lat, s.lng]);
        markers[s.callsign].setIcon(makeStationIcon(s.callsign));
        refreshPopup(s.callsign);
    } else {
        const m = L.marker([s.lat, s.lng], { icon: makeStationIcon(s.callsign) })
            .bindPopup('', { maxWidth: 300, maxHeight: 340 })
            .addTo(map);

        m.on('popupopen', function () { refreshPopup(s.callsign); });

        markers[s.callsign] = m;
    }

    if (fromSSE && isNew) {
        showToast(s.callsign + ' enrolled!');
        populateJoinSelect();
    }

    updateSidebar();

    // Redraw all lines that involve this station
    Object.keys(stations).forEach(cs => {
        if (cs !== s.callsign) updatePairLine(s.callsign, cs);
    });
}

function removeStation(callsign) {
    if (markers[callsign]) {
        map.removeLayer(markers[callsign]);
        delete markers[callsign];
    }
    delete stations[callsign];

    // Remove lines involving this station
    Object.keys(lines).forEach(key => {
        if (key.split('|').includes(callsign)) {
            lines[key].forEach(l => map.removeLayer(l));
            delete lines[key];
        }
    });

    reports = reports.filter(r => r.reporter !== callsign && r.target !== callsign);

    updateSidebar();
    populateJoinSelect();
}

// ── Map lines ────────────────────────────────────────────────────────────────

function lineKey(a, b) { return [a, b].sort().join('|'); }

function pairReports(a, b) {
    return reports.filter(r =>
        (r.reporter === a && r.target === b) ||
        (r.reporter === b && r.target === a)
    );
}

function signalColor(avg) {
    if (avg >= 8) return '#22bb22';
    if (avg >= 6) return '#aacc00';
    if (avg >= 4) return '#ff8800';
    return '#cc2200';
}

function updatePairLine(a, b) {
    if (!stations[a] || !stations[b]) return;

    const key  = lineKey(a, b);
    const rpts = pairReports(a, b);

    // Remove any existing pair lines
    if (lines[key]) {
        lines[key].forEach(l => { l.unbindTooltip(); map.removeLayer(l); });
        delete lines[key];
    }

    if (rpts.length === 0) return;

    // Split reports by signal direction, excluding R1/S1 (too poor to draw a line).
    // Signal travels a→b when b heard a  (reporter=b, target=a)
    // Signal travels b→a when a heard b  (reporter=a, target=b)
    const drawable   = rpts.filter(r => r.readability > 1 && r.signal_strength > 1);
    const aToBRpts   = drawable.filter(r => r.reporter === b && r.target === a);
    const bToARpts   = drawable.filter(r => r.reporter === a && r.target === b);

    if (aToBRpts.length === 0 && bToARpts.length === 0) return;

    const lls    = [[stations[a].lat, stations[a].lng], [stations[b].lat, stations[b].lng]];
    const allTip = buildLineTooltip(drawable);
    const created = [];

    function addLine(dirRpts, anim) {
        if (dirRpts.length === 0) return;
        const avgS  = dirRpts.reduce((sum, r) => sum + r.signal_strength, 0) / dirRpts.length;
        const color = signalColor(avgS);
        const l = L.polyline(lls, { color, weight: 2.5, opacity: 0.85, dashArray: '12 6', interactive: true })
            .bindTooltip(allTip, { sticky: true })
            .addTo(map);
        requestAnimationFrame(function () {
            const el = l.getElement();
            if (el) el.style.animation = anim + ' 1.5s linear infinite';
        });
        created.push(l);
    }

    addLine(aToBRpts, 'smx-dash-fwd');  // a→b, color from b's reception of a
    addLine(bToARpts, 'smx-dash-bwd');  // b→a, color from a's reception of b

    lines[key] = created;
}

function updateAllLines() {
    const css = Object.keys(stations);
    for (let i = 0; i < css.length; i++) {
        for (let j = i + 1; j < css.length; j++) {
            updatePairLine(css[i], css[j]);
        }
    }
}

function buildLineTooltip(rpts) {
    return rpts.map(r =>
        esc(r.reporter) + ' → ' + esc(r.target) +
        ': R' + r.readability + '/S' + r.signal_strength +
        (r.notes ? ' — ' + esc(r.notes) : '')
    ).join('<br>');
}

// ── Icons ────────────────────────────────────────────────────────────────────

// Pin dimensions (must match the CSS constants below)
const PIN_W  = 22;  // circle diameter
const PIN_TH = 10;  // triangle height
const PIN_TW = 14;  // triangle base width

function makeIcon(color, label) {
    // Triangle is a CSS border-trick: left+right transparent borders form the base,
    // top border (colored) forms the body.  border-top-color is set inline so the
    // color propagates to both circle and tip without a second variable.
    const tipLeft = (PIN_W - PIN_TW) / 2;   // centres the triangle under the circle
    const html =
        '<div class="pin-wrap">' +
          '<div class="pin-label">' + esc(label) + '</div>' +
          '<div class="pin-circle" style="background:' + color + '"></div>' +
          '<div class="pin-tip"    style="border-top-color:' + color + ';margin-left:' + tipLeft + 'px"></div>' +
        '</div>';

    return L.divIcon({
        className:  '',
        html:       html,
        iconSize:   [PIN_W, PIN_W + PIN_TH],
        // Anchor = tip of the triangle: horizontal centre, very bottom
        iconAnchor: [PIN_W / 2, PIN_W + PIN_TH]
    });
}

function makeStationIcon(callsign) {
    const color = callsign === myCallsign ? '#1d4ed8' : markerColor(callsign);
    return makeIcon(color, callsign);
}

function markerColor(callsign) {
    const rx = reports.filter(r => r.target === callsign);
    if (rx.length === 0) return '#6b7280';
    const avg = rx.reduce((s, r) => s + r.signal_strength, 0) / rx.length;
    return signalColor(avg);
}

function refreshAllMarkerIcons() {
    Object.keys(markers).forEach(cs => markers[cs].setIcon(makeStationIcon(cs)));
}

// ── Popup content ────────────────────────────────────────────────────────────

function refreshPopup(callsign) {
    if (!markers[callsign]) return;
    const popup = markers[callsign].getPopup();
    if (popup) popup.setContent(buildPopupContent(callsign));
}

function buildPopupContent(callsign) {
    const s = stations[callsign];
    if (!s) return '';

    const rows = [
        s.operator_name   ? row('Operator', s.operator_name)           : '',
        s.radio           ? row('Radio',    s.radio)                   : '',
        s.power_watts     ? row('Power',    s.power_watts + ' W')      : '',
        s.antenna_type    ? row('Antenna',  s.antenna_type)            : '',
        s.antenna_height_ft ? row('Height', s.antenna_height_ft + ' ft AGL') : '',
        s.notes           ? row('Notes',    s.notes)                   : '',
    ].filter(Boolean).join('');

    const rxRpts = reports.filter(r => r.target   === callsign);
    const txRpts = reports.filter(r => r.reporter === callsign);

    const rxHtml = rxRpts.length
        ? rxRpts.map(r => '<li><b>' + esc(r.reporter) + '</b> heard: R' + r.readability + '/S' + r.signal_strength + (r.notes ? ' — ' + esc(r.notes) : '') + '</li>').join('')
        : '<li class="empty">No reports yet</li>';

    const txHtml = txRpts.length
        ? txRpts.map(r => '<li>Heard <b>' + esc(r.target) + '</b>: R' + r.readability + '/S' + r.signal_strength + (r.notes ? ' — ' + esc(r.notes) : '') + '</li>').join('')
        : '<li class="empty">No reports yet</li>';

    let btn = '';
    if (myCallsign && myCallsign !== callsign) {
        btn = '<button class="popup-report-btn" data-target="' + esc(callsign) + '">Report from ' + esc(myCallsign) + '</button>';
    } else if (myCallsign === callsign) {
        btn = '<button class="popup-edit-btn">✏ Edit my station</button>';
    }

    return '<div class="popup-wrap">' +
        '<h3>' + esc(callsign) + '</h3>' +
        (rows ? '<table class="popup-table">' + rows + '</table>' : '') +
        '<div class="popup-section"><h4>Heard by others</h4><ul>' + rxHtml + '</ul></div>' +
        '<div class="popup-section"><h4>Reports from ' + esc(callsign) + '</h4><ul>' + txHtml + '</ul></div>' +
        btn +
        '</div>';
}

function row(label, value) {
    return '<tr><th>' + esc(label) + '</th><td>' + esc(value) + '</td></tr>';
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function updateSidebar() {
    const list = Object.values(stations).sort((a, b) => a.callsign.localeCompare(b.callsign));

    $('#station-count').text('Stations (' + list.length + ')');

    const $list = $('#station-list').empty();

    list.forEach(s => {
        const isMe     = s.callsign === myCallsign;
        const canClick = !!myCallsign && !isMe;

        const meBadge = isMe ? '<span class="me-badge">ME</span>' : '';

        // Two-column report badges: my report of them + their report of me
        let sigBadge = '';
        if (myCallsign && !isMe) {
            const myRpt    = reports.filter(r => r.reporter === myCallsign  && r.target === s.callsign).pop();
            const theirRpt = reports.filter(r => r.reporter === s.callsign  && r.target === myCallsign).pop();

            const mkBadge = (rpt) => rpt
                ? '<span class="sig-badge ' + sigClass(rpt.signal_strength) + '">R' + rpt.readability + '/S' + rpt.signal_strength + '</span>'
                : '<span class="sig-badge sig-none">—</span>';

            sigBadge =
                '<div class="si-badges">' +
                  '<div class="si-badge-col">' +
                    '<span class="si-badge-label">I hear</span>' +
                    mkBadge(myRpt) +
                  '</div>' +
                  '<div class="si-badge-col">' +
                    '<span class="si-badge-label">Hears me</span>' +
                    mkBadge(theirRpt) +
                  '</div>' +
                '</div>';
        }

        const info = [
            s.operator_name,
            s.radio,
            s.power_watts ? s.power_watts + ' W' : '',
            s.antenna_type
        ].filter(Boolean).join(' · ');

        const $item = $('<div>')
            .addClass('station-item')
            .toggleClass('is-me', isMe)
            .toggleClass('clickable', canClick || isMe)
            .attr('data-callsign', s.callsign)
            .html(
                '<div class="si-top">' +
                '<span class="si-callsign">' + esc(s.callsign) + ' ' + meBadge + '</span>' +
                sigBadge +
                '</div>' +
                (info ? '<div class="si-info">' + esc(info) + '</div>' : '')
            );

        if (canClick) {
            $item.on('click', () => showReportPanel(s.callsign));
        } else if (isMe) {
            $item.on('click', () => showEnrollPanel());
        } else {
            // Not enrolled yet — pan to the station and open its popup
            $item.on('click', () => {
                if (markers[s.callsign]) {
                    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 10));
                    markers[s.callsign].openPopup();
                }
            });
        }

        $list.append($item);
    });

    renderMyStationBar();
    populateJoinSelect();
}

function sigClass(s) {
    if (s >= 8) return 'sig-s89';
    if (s >= 6) return 'sig-s67';
    if (s >= 4) return 'sig-s45';
    return 'sig-s13';
}

// ── My station bar ────────────────────────────────────────────────────────────

function renderMyStationBar() {
    const $bar = $('#my-station-bar');

    if (myCallsign) {
        $bar.html(
            '<span class="cs-label">You are: <strong>' + esc(myCallsign) + '</strong></span>' +
            '<button id="btn-edit-station" title="Edit station info">✏ Edit</button>' +
            '<button id="btn-leave"        title="Stop identifying as this station">Leave</button>'
        );
        $('#btn-edit-station').on('click', showEnrollPanel);
        $('#btn-leave').on('click', leaveStation);
        $('#join-bar').addClass('hidden');
    } else {
        $bar.html(
            '<button id="btn-enroll-open" style="margin:0;padding:6px 14px;font-size:0.85rem">' +
            'Enroll My Station</button>'
        );
        $('#btn-enroll-open').on('click', showEnrollPanel);
        $('#join-bar').removeClass('hidden');
    }
}

function leaveStation() {
    if (!myCallsign) return;
    const cs = myCallsign;

    // Clear identity immediately so the UI updates right away
    myCallsign = null;
    localStorage.removeItem('myCallsign');

    // Remove from server (deletes station + its reports; SSE notifies other tabs)
    $.ajax({
        url:         'api/remove.php',
        type:        'POST',
        contentType: 'application/json',
        data:        JSON.stringify({ callsign: cs }),
        success: function () {
            removeStation(cs);
            showToast(cs + ' removed from the net.');
        },
        error: function (xhr) {
            const msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Could not remove station.';
            showToast(msg);
            // Still clean up locally even if server call failed
            removeStation(cs);
        }
    });

    renderMyStationBar();
    updateSidebar();
}

// ── Join select ───────────────────────────────────────────────────────────────

function populateJoinSelect() {
    const $sel = $('#join-select').empty().append('<option value="">— select —</option>');
    Object.keys(stations).sort().forEach(cs => {
        $sel.append($('<option>').val(cs).text(cs));
    });
    if (myCallsign && stations[myCallsign]) $sel.val(myCallsign);
}

// ── Enroll panel ──────────────────────────────────────────────────────────────

function showEnrollPanel() {
    enrollMode   = true;
    enrollLatLng = null;

    // Pre-fill form if updating own station
    if (myCallsign && stations[myCallsign]) {
        const s = stations[myCallsign];
        $('#f-callsign').val(s.callsign).prop('readonly', true);
        $('#f-operator-name').val(s.operator_name);
        $('#f-radio').val(s.radio);
        $('#f-power').val(s.power_watts || '');
        $('#f-antenna-type').val(s.antenna_type);
        $('#f-antenna-height').val(s.antenna_height_ft || '');
        $('#f-notes').val(s.notes);
        $('#enroll-title').text('Update My Station');
        setEnrollPin(L.latLng(s.lat, s.lng));
    } else {
        $('#enroll-form')[0].reset();
        $('#f-callsign').prop('readonly', false);
        $('#f-location-display').text('Not set — click the map').removeClass('set');
        $('#enroll-title').text('Enroll My Station');
    }

    $('#enroll-panel').removeClass('hidden');
    $('#report-panel').addClass('hidden');
    map.getContainer().style.cursor = 'crosshair';
}

function hideEnrollPanel() {
    enrollMode = false;
    if (enrollPin) { map.removeLayer(enrollPin); enrollPin = null; }
    enrollLatLng = null;
    $('#enroll-panel').addClass('hidden');
    map.getContainer().style.cursor = '';
}

// ── Report panel ──────────────────────────────────────────────────────────────

function showReportPanel(targetCallsign) {
    if (!myCallsign) {
        showToast('Please enroll your station first.');
        return;
    }
    if (targetCallsign === myCallsign) return;

    reportTarget = targetCallsign;
    selR = 0;
    selS = 0;

    $('#rpt-from').text(myCallsign);
    $('#rpt-to').text(targetCallsign);

    // Pre-fill with previous report if available
    const prev = reports.filter(r => r.reporter === myCallsign && r.target === targetCallsign).pop();
    if (prev) {
        selR = prev.readability;
        selS = prev.signal_strength;
        $('#rpt-notes').val(prev.notes);
    } else {
        $('#rpt-notes').val('');
    }

    buildRsButtons('#rbt-readability', 5,  'R', () => selR, v => { selR = v; });
    buildRsButtons('#rbt-signal',      9, 'S', () => selS, v => { selS = v; });

    $('#report-panel').removeClass('hidden');
    $('#enroll-panel').addClass('hidden');
}

function buildRsButtons(selector, max, prefix, getVal, setVal) {
    const $div = $(selector).empty();
    for (let i = 1; i <= max; i++) {
        const v = i;
        const $btn = $('<button type="button" class="rs-btn">')
            .text(prefix + i)
            .toggleClass('active', v === getVal());
        $btn.on('click', function () {
            setVal(v);
            $div.find('.rs-btn').removeClass('active');
            $btn.addClass('active');
        });
        $div.append($btn);
    }
}

// ── UI binding ────────────────────────────────────────────────────────────────

function bindUI() {
    // Enroll open button in sidebar header (static one in HTML)
    $('#btn-enroll-open').on('click', showEnrollPanel);

    // Cancel enroll
    $('#btn-cancel-enroll, #btn-cancel-enroll2').on('click', hideEnrollPanel);

    // Cancel report
    $('#btn-cancel-report, #btn-cancel-report2').on('click', function () {
        reportTarget = null;
        $('#report-panel').addClass('hidden');
    });

    // Join existing station
    $('#btn-join').on('click', function () {
        const cs = $('#join-select').val();
        if (!cs) { showToast('Select a call sign first.'); return; }
        myCallsign = cs;
        localStorage.setItem('myCallsign', cs);
        renderMyStationBar();
        updateSidebar();
        refreshAllMarkerIcons();
        Object.keys(markers).forEach(c => refreshPopup(c));
        showToast('Joined as ' + cs);
    });

    // Enroll form submit
    $('#enroll-form').on('submit', function (e) {
        e.preventDefault();

        const cs = ($('#f-callsign').val() || '').trim().toUpperCase();
        if (!cs) { showToast('Enter a call sign.'); return; }
        if (!/^[A-Z0-9]{3,12}(\/[A-Z0-9]{1,5})?$/.test(cs)) {
            showToast('Invalid call sign format.'); return;
        }
        if (!enrollLatLng) { showToast('Click the map to set your location.'); return; }

        const payload = {
            callsign:          cs,
            operator_name:     $('#f-operator-name').val().trim(),
            lat:               enrollLatLng.lat,
            lng:               enrollLatLng.lng,
            antenna_type:      $('#f-antenna-type').val().trim(),
            antenna_height_ft: parseFloat($('#f-antenna-height').val()) || 0,
            radio:             $('#f-radio').val().trim(),
            power_watts:       parseInt($('#f-power').val(), 10) || 0,
            notes:             $('#f-notes').val().trim()
        };

        $.ajax({
            url:         'api/enroll.php',
            type:        'POST',
            contentType: 'application/json',
            data:        JSON.stringify(payload),
            success: function (res) {
                myCallsign = cs;
                localStorage.setItem('myCallsign', cs);
                hideEnrollPanel();
                addOrUpdateStation(res.station, false);
                renderMyStationBar();
                updateSidebar();
                refreshAllMarkerIcons();
                showToast('Enrolled as ' + cs + '!');
            },
            error: function (xhr) {
                const msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Enrollment failed.';
                showToast(msg);
            }
        });
    });

    // Report form submit
    $('#report-form').on('submit', function (e) {
        e.preventDefault();
        if (!selR) { showToast('Select a readability (1–5).'); return; }
        if (!selS) { showToast('Select a signal strength (1–9).'); return; }

        const payload = {
            reporter:        myCallsign,
            target:          reportTarget,
            readability:     selR,
            signal_strength: selS,
            notes:           $('#rpt-notes').val().trim()
        };

        $.ajax({
            url:         'api/report.php',
            type:        'POST',
            contentType: 'application/json',
            data:        JSON.stringify(payload),
            success: function (res) {
                // Apply immediately so this tab updates without waiting for SSE
                applyNewReport(res.report, false);
                $('#report-panel').addClass('hidden');
                reportTarget = null;
                showToast('Report submitted: R' + selR + '/S' + selS);
            },
            error: function (xhr) {
                const msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Submission failed.';
                showToast(msg);
            }
        });
    });

    // Popup "Report from…" button (delegated — popup DOM is dynamic)
    $(document).on('click', '.popup-report-btn', function () {
        const tgt = $(this).data('target');
        showReportPanel(tgt);
    });

    // Popup "Edit my station" button (delegated)
    $(document).on('click', '.popup-edit-btn', function () {
        // Close the popup first so the panel doesn't open behind it
        map.closePopup();
        showEnrollPanel();
    });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function utcNow() {
    const d = new Date();
    return d.getUTCFullYear()              + '-' +
           pad(d.getUTCMonth() + 1)        + '-' +
           pad(d.getUTCDate())             + ' ' +
           pad(d.getUTCHours())            + ':' +
           pad(d.getUTCMinutes())          + ':' +
           pad(d.getUTCSeconds());
}

function pad(n) { return String(n).padStart(2, '0'); }

function showToast(msg) {
    clearTimeout(toastTimer);
    $('#toast').text(msg).addClass('show');
    toastTimer = setTimeout(() => $('#toast').removeClass('show'), 3500);
}
