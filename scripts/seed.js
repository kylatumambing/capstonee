#!/usr/bin/env node
/**
 * Seed Firestore with 1 MHO admin, 50 BHW, 26 BNS users, and sample structure.
 * Requires: GOOGLE_APPLICATION_CREDENTIALS set or pass --key path and --project id
 */

const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

function parseArgs(){
  const args = process.argv.slice(2);
  const out = {};
  for(let i=0;i<args.length;i+=2){
    const k=args[i]; const v=args[i+1];
    if(!k) break;
    if(k==='--project') out.projectId=v;
    if(k==='--key') out.keyPath=v;
  }
  return out;
}

(async function main(){
  try {
    const { projectId, keyPath } = parseArgs();
    let app;
    if(keyPath){
      const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(keyPath), 'utf8'));
      app = initializeApp({ credential: cert(serviceAccount), projectId: projectId || serviceAccount.project_id });
    } else {
      app = initializeApp({ credential: applicationDefault(), projectId });
    }

    const auth = getAuth(app);
    const db = getFirestore(app);

    // Create MHO admin
    const mhoEmail = 'mho@gmail.com';
    const mhoPassword = 'password';
    let mhoUserRecord;
    try {
      mhoUserRecord = await auth.getUserByEmail(mhoEmail);
    } catch (_) {}
    if(!mhoUserRecord){
      mhoUserRecord = await auth.createUser({ email: mhoEmail, password: mhoPassword, displayName: 'Municipal Health Officer' });
      await auth.setCustomUserClaims(mhoUserRecord.uid, { role: 'MHO', email: mhoEmail });
      await db.collection('users').doc(mhoUserRecord.uid).set({
        role: 'MHO', email: mhoEmail, name: 'Municipal Health Officer'
      }, { merge: true });
      console.log('Created MHO admin');
    } else {
      await auth.setCustomUserClaims(mhoUserRecord.uid, { role: 'MHO', email: mhoEmail });
      await db.collection('users').doc(mhoUserRecord.uid).set({ role:'MHO', email: mhoEmail, name: 'Municipal Health Officer' }, { merge: true });
      console.log('Ensured MHO admin exists');
    }

    const barangays = [
      'Abiacao','Bagong Tubig','Balagtasin','Balite','Banoyo','Boboy','Bonliw','Calumpang East','Calumpang West','Dulangan','Durungao','Locloc','Luya','Mahabang Parang','Manggahan','Muzon','San Antonio','San Isidro','San Jose','San Martin','Santa Monica','Taliba','Talon','Tejero','Tungal','Población'
    ];
    const sectors = ['Sector A','Sector B','Sector C'];

    // Helpers
    async function ensureUser({ email, password, name, role, barangay, sector }){
      email = email.toLowerCase();
      let u;
      try { u = await auth.getUserByEmail(email); } catch(_) {}
      if(!u){ u = await auth.createUser({ email, password, displayName: name }); }
      await auth.setCustomUserClaims(u.uid, { role, email });
      await db.collection('users').doc(u.uid).set({ email, name, role, barangay: barangay||'', sector: sector||'' }, { merge: true });
      return u;
    }

    // Create 50 BHW users distributed across barangays/sectors
    let bhwCount = 50;
    for(let i=0;i<bhwCount;i++){
      const b = barangays[i % barangays.length];
      const s = sectors[i % sectors.length];
      const email = `${b.toLowerCase().replace(/\s/g,'')}.bhw${Math.floor(i/ barangays.length)+1}@gmail.com`;
      await ensureUser({ email, password: 'password', name: `${b} BHW ${i+1}`, role:'BHW', barangay:b, sector:s });
    }
    console.log('Ensured 50 BHW users');

    // Create 26 BNS users (one per first 26 barangays)
    for(let i=0;i<26;i++){
      const b = barangays[i % barangays.length];
      const email = `${b.toLowerCase().replace(/\s/g,'')}.bns@gmail.com`;
      await ensureUser({ email, password: 'password', name: `${b} BNS`, role:'BNS', barangay:b });
    }
    console.log('Ensured 26 BNS users');

    // Optionally create an example child record per BHW
    const childrenCol = db.collection('children');
    const exampleVaccines = ['BCG','HEPA B','PENTA 1','PENTA 2','PENTA 3','OPV1','OPV2','OPV3','IPV1','IPV2','PCV1','PCV2','PCV3','MCV1','MCV2'];
    for(let i=0;i<10;i++){
      // only a few samples to avoid huge seed
      const b = barangays[i % barangays.length];
      const s = sectors[i % sectors.length];
      await childrenCol.add({
        name: `Child ${i+1}`,
        birthDate: '2021-01-01',
        ageMonths: 48,
        motherName: `Mother ${i+1}`,
        barangay: b,
        sector: s,
        bhwEmail: `${b.toLowerCase().replace(/\s/g,'')}.bhw1@gmail.com`,
        vaccines: Object.fromEntries(exampleVaccines.map(v=>[v,'Needed']))
      });
    }

    console.log('Seeding complete');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
