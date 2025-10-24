const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data.db');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize DB
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('BNS','BHW','MHO')),
    barangay TEXT,
    sector TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS children (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_name TEXT,
    age_months INTEGER,
    date_of_birth TEXT,
    parent_name TEXT,
    barangay TEXT,
    sector TEXT,
    bcg TEXT, hepa_b TEXT,
    penta1 TEXT, penta2 TEXT, penta3 TEXT,
    opv1 TEXT, opv2 TEXT, opv3 TEXT,
    ipv1 TEXT, ipv2 TEXT,
    pcv1 TEXT, pcv2 TEXT, pcv3 TEXT,
    mcv1 TEXT, mcv2 TEXT,
    report_month TEXT, -- MM
    report_year TEXT   -- YYYY
  )`);
});

// Seed endpoint (idempotent)
app.post('/api/seed', (req, res) => {
  db.serialize(() => {
    db.run(`INSERT OR IGNORE INTO profiles(name,email,password,role,barangay,sector)
            VALUES ('Municipal Health Office','mho@gmail.com','password','MHO',NULL,NULL)`);

    const barangays = ["Abiacao","Bagong Tubig","Balagtasin","Balite","Banoyo","Boboy","Bonliw","Calumpang East","Calumpang West","Dulangan","Durungao","Locloc","Luya","Mahabang Parang","Manggahan","Muzon","San Antonio","San Isidro","San Jose","San Martin","Santa Monica","Taliba","Talon","Tejero","Tungal","Poblacion"];
    const sectors = ["Sector A","Sector B","Sector C"];

    const insertProfile = db.prepare(`INSERT OR IGNORE INTO profiles(name,email,password,role,barangay,sector) VALUES (?,?,?,?,?,?)`);
    barangays.forEach(b => {
      insertProfile.run(`${b} BNS`, `${b.toLowerCase().replace(/\s/g,'')}bns@gmail.com`, 'password', 'BNS', b, null);
      insertProfile.run(`${b} BHW 1`, `${b.toLowerCase().replace(/\s/g,'')}bhw1@gmail.com`, 'password', 'BHW', b, 'Sector A');
    });
    insertProfile.finalize();

    const insertChild = db.prepare(`INSERT INTO children(child_name,age_months,date_of_birth,parent_name,barangay,sector,
      bcg,hepa_b,penta1,penta2,penta3,opv1,opv2,opv3,ipv1,ipv2,pcv1,pcv2,pcv3,mcv1,mcv2,report_month,report_year)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?)`);

    // Seed a few demo children if table is empty
    db.get('SELECT COUNT(*) as c FROM children', (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (row.c === 0) {
        const today = new Date();
        const yr = String(today.getFullYear());
        const mo = String(today.getMonth()+1).padStart(2,'0');
        for (let i=0;i<50;i++) {
          const b = barangays[i % barangays.length];
          const s = sectors[i % sectors.length];
          const accepted = (p)=> (Math.random() < p ? 'Accepted' : '');
          insertChild.run(
            `Child ${i+1}`, (i%60)+1, '2024-01-01', `Parent ${i+1}`, b, s,
            accepted(0.9), accepted(0.85),
            accepted(0.8), accepted(0.75), accepted(0.7),
            accepted(0.8), accepted(0.75), accepted(0.7),
            accepted(0.65), accepted(0.6),
            accepted(0.75), accepted(0.7), accepted(0.65),
            accepted(0.6), accepted(0.55),
            mo, yr
          );
        }
      }
      insertChild.finalize();
      res.json({ status: 'ok' });
    });
  });
});

// Profiles
app.get('/api/profiles', (req,res)=>{
  db.all('SELECT * FROM profiles', (err, rows)=>{
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Children list with optional filters
app.get('/api/children', (req,res)=>{
  const { barangay, sector, year, month } = req.query;
  const conds = [];
  const params = [];
  if (barangay) { conds.push('barangay = ?'); params.push(barangay); }
  if (sector) { conds.push('sector = ?'); params.push(sector); }
  if (year) { conds.push('report_year = ?'); params.push(year); }
  if (month) { conds.push('report_month = ?'); params.push(month); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const sql = `SELECT * FROM children ${where}`;
  db.all(sql, params, (err, rows)=>{
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Stats endpoint for analytics
app.get('/api/stats', (req,res)=>{
  const { barangay } = req.query; // optional filter
  const where = barangay ? 'WHERE barangay = ?' : '';
  const params = barangay ? [barangay] : [];

  db.all(`SELECT * FROM children ${where}`, params, (err, rows)=>{
    if (err) return res.status(500).json({error: err.message});

    const vaccines = ['bcg','hepa_b','penta1','penta2','penta3','opv1','opv2','opv3','ipv1','ipv2','pcv1','pcv2','pcv3','mcv1','mcv2'];
    const acceptedCounts = Object.fromEntries(vaccines.map(v=>[v,0]));
    let fully = 0;

    rows.forEach(r=>{
      let allAccepted = true;
      vaccines.forEach(v=>{ if (r[v]==='Accepted') acceptedCounts[v]++; else allAccepted = false; });
      if (allAccepted) fully++;
    });

    const brgyMap = {};
    rows.forEach(r=>{
      const b = r.barangay || 'Unknown';
      if (!brgyMap[b]) brgyMap[b] = { total: 0, fully: 0 };
      brgyMap[b].total += 1;
      const allAcc = vaccines.every(v => r[v] === 'Accepted');
      if (allAcc) brgyMap[b].fully += 1;
    });

    res.json({
      total: rows.length,
      fully,
      acceptedCounts,
      byBarangay: brgyMap
    });
  });
});

// Serve index files (fallback)
app.get('/', (req,res)=>{
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
