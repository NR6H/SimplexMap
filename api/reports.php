<?php
header('Access-Control-Allow-Origin: *');
require_once 'db.php';

$db = getDB();
$reports = $db->query("SELECT * FROM reception_reports ORDER BY reported_at ASC")->fetchAll();
jsonOut($reports);
