# SimplexMap

A real-time, multi-user web app for amateur radio operators to coordinate and log simplex (direct, no repeater) propagation tests.

Operators enroll their station on an interactive map, then submit RS reception reports for stations they can hear. Signal quality lines animate between stations to show propagation in each direction.

## Rationale

North Hills Radio Club (K6IS.org) in Sacramento runs a weekly "simplex net". This application is intended to help participating stations track who they can hear, and who can hear them. It's a real-time map-view, and is intended to be hosted on a public server. 

Stations add themselves to the app. No credentials are required, and the registrations will automatically be deleted after 20 hours.

## Features

- **Live map** — drop-pin markers for each enrolled station; lines appear between stations that have exchanged reports
- **Directional signal lines** — two animated dashed lines per pair, each colored by the average signal strength in that direction
- **RS reports** — readability (1–5) and signal strength (1–9) per the standard RS scale
- **Real-time updates** — Server-Sent Events push new stations and reports to all connected browsers instantly
- **Auto-cleanup** — stations inactive for 20 hours are removed automatically
- **Join existing station** — rejoin your callsign from any browser without re-enrolling

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + jQuery + [Leaflet.js](https://leafletjs.com/) (OpenStreetMap) |
| Backend | PHP (REST endpoints + SSE stream) |
| Storage | SQLite (WAL mode) |

## Requirements

- PHP 8.0+ with the `pdo_sqlite` extension
- A web server (Apache, Nginx, or PHP's built-in server)
- Write access to the `data/` directory

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/NR6H/SimplexMap.git
   cd SimplexMap
   ```

2. **Create the data directory** (if it doesn't already exist)
   ```bash
   mkdir -p data
   ```

3. **Set permissions** so PHP can write the database
   ```bash
   chmod 775 data/
   ```

4. **Point your web server** at the project root, or use PHP's built-in server for local testing:
   ```bash
   php -S localhost:8080
   ```
   Then open `http://localhost:8080` in your browser.

> **Apache users:** the `data/.htaccess` file already denies direct web access to the SQLite database. Nginx users should add a `location /data { deny all; }` block to their server config.

## Usage

1. Click **Enroll My Station** and fill in your callsign, operator name, and station details, then click your location on the map.
2. Other operators do the same from their browsers.
3. Click a station in the sidebar (or its map marker popup) to submit a reception report for it.
4. Signal lines appear between stations as reports come in, colored by signal strength:

| Color | Signal |
|-------|--------|
| 🟢 Green | S8–S9 — Strong |
| 🟡 Yellow-green | S6–S7 — Good |
| 🟠 Orange | S4–S5 — Fair |
| 🔴 Red | S1–S3 — Weak |

Lines are not drawn for R1 or S1 reports (essentially no copy).

## File Layout

```
SimplexMap/
├── index.html          Main SPA
├── style.css
├── app.js              All frontend logic (jQuery + Leaflet)
├── api/
│   ├── db.php          SQLite init, schema, helpers
│   ├── enroll.php      POST — upsert station
│   ├── stations.php    GET  — all stations
│   ├── report.php      POST — submit RS report
│   ├── reports.php     GET  — all reports
│   ├── remove.php      POST — remove own station
│   └── events.php      GET  — SSE stream
└── data/
    └── .htaccess       Deny direct web access to the database
```

## License

MIT

Very few brain cells were harmed in the creation of this app. Claude did all the work.
