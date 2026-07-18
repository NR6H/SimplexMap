<?php
header('Access-Control-Allow-Origin: *');
require_once 'db.php';

$db = getDB();
cleanupStale($db);

$stations = $db->query("SELECT * FROM stations ORDER BY callsign ASC")->fetchAll();
jsonOut($stations);
