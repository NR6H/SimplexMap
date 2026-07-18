<?php
/**
 * SimplexMap — shared database helpers
 * All timestamps stored as UTC in "YYYY-MM-DD HH:MM:SS" format.
 */

function getDB(): PDO {
    $dbPath = __DIR__ . '/../data/simplex.db';
    $db = new PDO('sqlite:' . $dbPath);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    // WAL mode for concurrent readers/writers
    $db->exec("PRAGMA journal_mode=WAL");
    $db->exec("PRAGMA synchronous=NORMAL");
    $db->exec("PRAGMA foreign_keys=ON");

    $db->exec("CREATE TABLE IF NOT EXISTS stations (
        callsign          TEXT    PRIMARY KEY,
        operator_name     TEXT    NOT NULL DEFAULT '',
        lat               REAL    NOT NULL,
        lng               REAL    NOT NULL,
        antenna_type      TEXT    NOT NULL DEFAULT '',
        antenna_height_ft REAL    NOT NULL DEFAULT 0,
        radio             TEXT    NOT NULL DEFAULT '',
        power_watts       INTEGER NOT NULL DEFAULT 0,
        notes             TEXT    NOT NULL DEFAULT '',
        enrolled_at       TEXT    NOT NULL,
        last_updated      TEXT    NOT NULL,
        last_seen         TEXT    NOT NULL
    )");

    // Migration: add operator_name to existing databases that predate this column
    try {
        $db->exec("ALTER TABLE stations ADD COLUMN operator_name TEXT NOT NULL DEFAULT ''");
    } catch (PDOException $e) {
        // Column already exists — safe to ignore
    }

    $db->exec("CREATE TABLE IF NOT EXISTS reception_reports (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter        TEXT    NOT NULL,
        target          TEXT    NOT NULL,
        readability     INTEGER NOT NULL,
        signal_strength INTEGER NOT NULL,
        notes           TEXT    NOT NULL DEFAULT '',
        reported_at     TEXT    NOT NULL
    )");

    // Log of explicitly-removed stations so SSE can notify other clients.
    // Rows are pruned after 24 hours.
    $db->exec("CREATE TABLE IF NOT EXISTS removed_stations (
        callsign   TEXT NOT NULL,
        removed_at TEXT NOT NULL
    )");

    return $db;
}

/**
 * Remove stations whose last_seen is older than 20 hours.
 * Also removes all reports associated with those stations.
 * Returns array of removed callsigns.
 */
function cleanupStale(PDO $db): array {
    $cutoff = gmdate('Y-m-d H:i:s', time() - 20 * 3600);

    $stmt = $db->prepare("SELECT callsign FROM stations WHERE last_seen < ?");
    $stmt->execute([$cutoff]);
    $stale = $stmt->fetchAll(PDO::FETCH_COLUMN);

    if (!empty($stale)) {
        $ph = implode(',', array_fill(0, count($stale), '?'));
        $db->prepare("DELETE FROM reception_reports WHERE reporter IN ($ph) OR target IN ($ph)")
           ->execute(array_merge($stale, $stale));
        $db->prepare("DELETE FROM stations WHERE callsign IN ($ph)")
           ->execute($stale);
    }

    return $stale;
}

function jsonOut(mixed $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
