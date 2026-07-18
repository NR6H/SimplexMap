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

$callsign = strtoupper(trim($data['callsign'] ?? ''));

if ($callsign === '') {
    jsonOut(['error' => 'callsign is required'], 400);
}

$db  = getDB();
$now = gmdate('Y-m-d H:i:s');

// Verify the station exists
$chk = $db->prepare("SELECT callsign FROM stations WHERE callsign = ?");
$chk->execute([$callsign]);
if (!$chk->fetch()) {
    jsonOut(['error' => 'Station not found'], 404);
}

// Delete reports involving this station
$db->prepare("DELETE FROM reception_reports WHERE reporter = ? OR target = ?")
   ->execute([$callsign, $callsign]);

// Delete the station
$db->prepare("DELETE FROM stations WHERE callsign = ?")
   ->execute([$callsign]);

// Log the removal so the SSE loop can notify other clients
$db->prepare("INSERT INTO removed_stations (callsign, removed_at) VALUES (?, ?)")
   ->execute([$callsign, $now]);

// Prune removed_stations log entries older than 24 hours
$db->exec("DELETE FROM removed_stations WHERE removed_at < '" .
    gmdate('Y-m-d H:i:s', time() - 86400) . "'");

jsonOut(['success' => true]);
