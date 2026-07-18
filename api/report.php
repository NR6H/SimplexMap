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

$reporter        = strtoupper(trim($data['reporter']        ?? ''));
$target          = strtoupper(trim($data['target']          ?? ''));
$readability     = (int)($data['readability']               ?? 0);
$signal_strength = (int)($data['signal_strength']           ?? 0);
$notes           = trim($data['notes']                      ?? '');

if ($reporter === '' || $target === '') {
    jsonOut(['error' => 'reporter and target are required'], 400);
}
if ($reporter === $target) {
    jsonOut(['error' => 'Cannot report on your own station'], 400);
}
if ($readability < 1 || $readability > 5) {
    jsonOut(['error' => 'readability must be 1–5'], 400);
}
if ($signal_strength < 1 || $signal_strength > 9) {
    jsonOut(['error' => 'signal_strength must be 1–9'], 400);
}

$db  = getDB();
$now = gmdate('Y-m-d H:i:s');

// Confirm both stations exist
$chk = $db->prepare("SELECT callsign FROM stations WHERE callsign = ?");
$chk->execute([$reporter]);
if (!$chk->fetch()) {
    jsonOut(['error' => "Reporter '$reporter' is not enrolled"], 400);
}
$chk->execute([$target]);
if (!$chk->fetch()) {
    jsonOut(['error' => "Target '$target' is not enrolled"], 400);
}

$db->prepare("
    INSERT INTO reception_reports (reporter, target, readability, signal_strength, notes, reported_at)
    VALUES (?, ?, ?, ?, ?, ?)
")->execute([$reporter, $target, $readability, $signal_strength, $notes, $now]);

$id = (int)$db->lastInsertId();

// Refresh reporter's last_seen so they don't age out due to inactivity
$db->prepare("UPDATE stations SET last_seen = ? WHERE callsign = ?")
   ->execute([$now, $reporter]);

$q = $db->prepare("SELECT * FROM reception_reports WHERE id = ?");
$q->execute([$id]);
$report = $q->fetch();

jsonOut(['success' => true, 'report' => $report]);
