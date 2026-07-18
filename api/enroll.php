<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonOut(['error' => 'Method not allowed'], 405);
}

$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) {
    jsonOut(['error' => 'Invalid JSON'], 400);
}

$callsign        = strtoupper(trim($data['callsign'] ?? ''));
$operator_name   = trim($data['operator_name']   ?? '');
$lat             = isset($data['lat'])  ? (float)$data['lat']  : null;
$lng             = isset($data['lng'])  ? (float)$data['lng']  : null;
$antenna_type    = trim($data['antenna_type']    ?? '');
$antenna_height  = (float)($data['antenna_height_ft'] ?? 0);
$radio           = trim($data['radio']           ?? '');
$power_watts     = (int)($data['power_watts']     ?? 0);
$notes           = trim($data['notes']            ?? '');

// Validate required fields
if ($callsign === '') {
    jsonOut(['error' => 'callsign is required'], 400);
}
if (!preg_match('/^[A-Z0-9]{3,12}(\/[A-Z0-9]{1,5})?$/', $callsign)) {
    jsonOut(['error' => 'Invalid callsign format'], 400);
}
if ($lat === null || $lng === null) {
    jsonOut(['error' => 'lat and lng are required'], 400);
}
if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
    jsonOut(['error' => 'lat/lng out of range'], 400);
}

$db  = getDB();
$now = gmdate('Y-m-d H:i:s');

// Upsert: insert or update all fields except enrolled_at (preserved on update)
$stmt = $db->prepare("
    INSERT INTO stations
        (callsign, operator_name, lat, lng, antenna_type, antenna_height_ft, radio, power_watts, notes, enrolled_at, last_updated, last_seen)
    VALUES
        (:cs, :on, :lat, :lng, :at, :ah, :radio, :pw, :notes, :now, :now, :now)
    ON CONFLICT(callsign) DO UPDATE SET
        operator_name     = excluded.operator_name,
        lat               = excluded.lat,
        lng               = excluded.lng,
        antenna_type      = excluded.antenna_type,
        antenna_height_ft = excluded.antenna_height_ft,
        radio             = excluded.radio,
        power_watts       = excluded.power_watts,
        notes             = excluded.notes,
        last_updated      = excluded.last_updated,
        last_seen         = excluded.last_seen
");
$stmt->execute([
    ':cs'    => $callsign,
    ':on'    => $operator_name,
    ':lat'   => $lat,
    ':lng'   => $lng,
    ':at'    => $antenna_type,
    ':ah'    => $antenna_height,
    ':radio' => $radio,
    ':pw'    => $power_watts,
    ':notes' => $notes,
    ':now'   => $now,
]);

$q = $db->prepare("SELECT * FROM stations WHERE callsign = ?");
$q->execute([$callsign]);
$station = $q->fetch();

jsonOut(['success' => true, 'station' => $station]);
