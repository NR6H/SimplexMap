<?php
/**
 * SimplexMap SSE endpoint.
 * Keeps an HTTP connection open and pushes JSON events whenever the DB changes.
 *
 * Event types emitted:
 *   station         – a station was added or updated
 *   station_removed – a station was deleted (staleness or manual)
 *   report          – a new reception report was filed
 */

set_time_limit(0);
ignore_user_abort(false);

header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');   // disable nginx buffering
header('Access-Control-Allow-Origin: *');

// Flush any existing output buffer
while (ob_get_level()) ob_end_clean();

require_once 'db.php';
$db = getDB();

// Accept client's "since" cursor so reconnects don't miss events.
// Validate format; fall back to 1 second ago if missing/invalid.
$sinceRaw = $_GET['since'] ?? '';
if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $sinceRaw)) {
    $since = $sinceRaw;
} else {
    $since = gmdate('Y-m-d H:i:s', time() - 1);
}

// Send an initial comment so the client knows the connection is live.
echo ": connected\n\n";
flush();

$lastCleanup = time();

while (true) {
    if (connection_aborted()) break;

    $now = gmdate('Y-m-d H:i:s');

    // ── Periodic staleness cleanup (every 60 s) ───────────────────────────
    if (time() - $lastCleanup >= 60) {
        $removed = cleanupStale($db);
        foreach ($removed as $cs) {
            sendEvent('station_removed', ['callsign' => $cs]);
        }
        $lastCleanup = time();
    }

    // ── New / updated stations ────────────────────────────────────────────
    $stmt = $db->prepare("SELECT * FROM stations WHERE last_updated > ? ORDER BY last_updated ASC");
    $stmt->execute([$since]);
    foreach ($stmt->fetchAll() as $row) {
        sendEvent('station', $row);
    }

    // ── New reception reports ─────────────────────────────────────────────
    $stmt = $db->prepare("SELECT * FROM reception_reports WHERE reported_at > ? ORDER BY reported_at ASC");
    $stmt->execute([$since]);
    foreach ($stmt->fetchAll() as $row) {
        sendEvent('report', $row);
    }

    // ── Explicit station removals (via Leave button) ───────────────────────
    $stmt = $db->prepare("SELECT callsign FROM removed_stations WHERE removed_at > ? ORDER BY removed_at ASC");
    $stmt->execute([$since]);
    foreach ($stmt->fetchAll() as $row) {
        sendEvent('station_removed', ['callsign' => $row['callsign']]);
    }

    $since = $now;
    flush();
    sleep(2);
}

// ─────────────────────────────────────────────────────────────────────────────

function sendEvent(string $type, array $data): void {
    echo "event: $type\n";
    echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";
}
