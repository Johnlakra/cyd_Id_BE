-- scripts/reconcileDeaneryParish.sql
-- =====================================================================================
-- Reconcile `deanery` and `parish` to the STATIC source-of-truth list. Additive + the
-- two discovered name normalizations. Idempotent: safe to run repeatedly (a settled DB
-- changes 0 rows). GENERATED from scripts/reconcileDeaneryParish.js DEANERIES/PARISH_RENAMES.
--
-- HOW TO RUN
--   Local:       mysql -h localhost -u root cyd_new < scripts/reconcileDeaneryParish.sql
--   PRODUCTION:  mysql -h <prod-host> -P <prod-port> --ssl-mode=REQUIRED -u <user> -p <db> \
--                  < scripts/reconcileDeaneryParish.sql
--                (or use the JS runner: npm run reconcile-deanery-parish)
--
-- SAFETY: additive + the 2 in-place renames below; DELETES nothing. The DELETE block at
--   the bottom is OFF by default. >>> TAKE A DB BACKUP before the first PRODUCTION run. <<<
-- =====================================================================================

-- 1) Name normalizations (STATIC wins; UPDATE in place to preserve id/FK). BINARY match
--    so trailing-space/spelling variants are distinguished; idempotent after first run.
UPDATE parish p JOIN deanery d ON p.deanery_id = d.id SET p.name = 'Ajnala ' WHERE d.name = 'Ajnala' AND BINARY p.name = 'Ajnala';
UPDATE parish p JOIN deanery d ON p.deanery_id = d.id SET p.name = 'Badhni Mahafariste Wala' WHERE d.name = 'Ferozpur' AND BINARY p.name = 'Ferozepur Badhni Mahafariste Wala';

-- 2) Deaneries: insert only if absent (default collation match).
INSERT INTO deanery (name) SELECT 'Ajnala' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Ajnala');
INSERT INTO deanery (name) SELECT 'Amritsar' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Amritsar');
INSERT INTO deanery (name) SELECT 'Dhariwal' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Dhariwal');
INSERT INTO deanery (name) SELECT 'Fatehgarh Churian' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Fatehgarh Churian');
INSERT INTO deanery (name) SELECT 'Ferozpur' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Ferozpur');
INSERT INTO deanery (name) SELECT 'Gurdaspur' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Gurdaspur');
INSERT INTO deanery (name) SELECT 'Hoshiarpur' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Hoshiarpur');
INSERT INTO deanery (name) SELECT 'Jalandhar Cantt.' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Jalandhar Cantt.');
INSERT INTO deanery (name) SELECT 'Jalandhar City' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Jalandhar City');
INSERT INTO deanery (name) SELECT 'Kapurthala' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Kapurthala');
INSERT INTO deanery (name) SELECT 'Ludhiana' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Ludhiana');
INSERT INTO deanery (name) SELECT 'Moga' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Moga');
INSERT INTO deanery (name) SELECT 'Muktsar' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Muktsar');
INSERT INTO deanery (name) SELECT 'Sahnewal' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Sahnewal');
INSERT INTO deanery (name) SELECT 'Tanda' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Tanda');
INSERT INTO deanery (name) SELECT 'Tarn Taran' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM deanery WHERE name = 'Tarn Taran');

-- 3) Parishes: insert under their deanery only if absent. PADSPACE match means a row
--    already fixed by the rename pass is not re-inserted as a duplicate.
INSERT INTO parish (name, deanery_id) SELECT 'Ajnala ', d.id FROM deanery d WHERE d.name = 'Ajnala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Ajnala ');
INSERT INTO parish (name, deanery_id) SELECT 'Chamiyari', d.id FROM deanery d WHERE d.name = 'Ajnala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Chamiyari');
INSERT INTO parish (name, deanery_id) SELECT 'Chogawan', d.id FROM deanery d WHERE d.name = 'Ajnala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Chogawan');
INSERT INTO parish (name, deanery_id) SELECT 'Chuchakwal', d.id FROM deanery d WHERE d.name = 'Ajnala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Chuchakwal');
INSERT INTO parish (name, deanery_id) SELECT 'Karyal', d.id FROM deanery d WHERE d.name = 'Ajnala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Karyal');
INSERT INTO parish (name, deanery_id) SELECT 'Othian', d.id FROM deanery d WHERE d.name = 'Ajnala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Othian');
INSERT INTO parish (name, deanery_id) SELECT 'Punga', d.id FROM deanery d WHERE d.name = 'Ajnala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Punga');
INSERT INTO parish (name, deanery_id) SELECT 'Ramdas', d.id FROM deanery d WHERE d.name = 'Ajnala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Ramdas');
INSERT INTO parish (name, deanery_id) SELECT 'Amritsar Cantt.', d.id FROM deanery d WHERE d.name = 'Amritsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Amritsar Cantt.');
INSERT INTO parish (name, deanery_id) SELECT 'Bharariwal', d.id FROM deanery d WHERE d.name = 'Amritsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bharariwal');
INSERT INTO parish (name, deanery_id) SELECT 'Gumtala', d.id FROM deanery d WHERE d.name = 'Amritsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Gumtala');
INSERT INTO parish (name, deanery_id) SELECT 'Khasa', d.id FROM deanery d WHERE d.name = 'Amritsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Khasa');
INSERT INTO parish (name, deanery_id) SELECT 'Lahorigate', d.id FROM deanery d WHERE d.name = 'Amritsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Lahorigate');
INSERT INTO parish (name, deanery_id) SELECT 'Majitha Road', d.id FROM deanery d WHERE d.name = 'Amritsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Majitha Road');
INSERT INTO parish (name, deanery_id) SELECT 'Nai Abadi', d.id FROM deanery d WHERE d.name = 'Amritsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Nai Abadi');
INSERT INTO parish (name, deanery_id) SELECT 'Rajasansi', d.id FROM deanery d WHERE d.name = 'Amritsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Rajasansi');
INSERT INTO parish (name, deanery_id) SELECT 'Batala', d.id FROM deanery d WHERE d.name = 'Dhariwal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Batala');
INSERT INTO parish (name, deanery_id) SELECT 'Dhariwal', d.id FROM deanery d WHERE d.name = 'Dhariwal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dhariwal');
INSERT INTO parish (name, deanery_id) SELECT 'Dialgarh', d.id FROM deanery d WHERE d.name = 'Dhariwal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dialgarh');
INSERT INTO parish (name, deanery_id) SELECT 'Kalanaur', d.id FROM deanery d WHERE d.name = 'Dhariwal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kalanaur');
INSERT INTO parish (name, deanery_id) SELECT 'Mastkot', d.id FROM deanery d WHERE d.name = 'Dhariwal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Mastkot');
INSERT INTO parish (name, deanery_id) SELECT 'Naushera Majja Singh', d.id FROM deanery d WHERE d.name = 'Dhariwal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Naushera Majja Singh');
INSERT INTO parish (name, deanery_id) SELECT 'Qadian', d.id FROM deanery d WHERE d.name = 'Dhariwal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Qadian');
INSERT INTO parish (name, deanery_id) SELECT 'Fatehgarh Churian', d.id FROM deanery d WHERE d.name = 'Fatehgarh Churian' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Fatehgarh Churian');
INSERT INTO parish (name, deanery_id) SELECT 'Dera Baba Nanak', d.id FROM deanery d WHERE d.name = 'Fatehgarh Churian' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dera Baba Nanak');
INSERT INTO parish (name, deanery_id) SELECT 'Dharamkot Randhawa', d.id FROM deanery d WHERE d.name = 'Fatehgarh Churian' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dharamkot Randhawa');
INSERT INTO parish (name, deanery_id) SELECT 'Ghanie Ke Banger', d.id FROM deanery d WHERE d.name = 'Fatehgarh Churian' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Ghanie Ke Banger');
INSERT INTO parish (name, deanery_id) SELECT 'Kotli', d.id FROM deanery d WHERE d.name = 'Fatehgarh Churian' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kotli');
INSERT INTO parish (name, deanery_id) SELECT 'Machi Nangal', d.id FROM deanery d WHERE d.name = 'Fatehgarh Churian' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Machi Nangal');
INSERT INTO parish (name, deanery_id) SELECT 'Majitha', d.id FROM deanery d WHERE d.name = 'Fatehgarh Churian' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Majitha');
INSERT INTO parish (name, deanery_id) SELECT 'Pakharpura', d.id FROM deanery d WHERE d.name = 'Fatehgarh Churian' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Pakharpura');
INSERT INTO parish (name, deanery_id) SELECT 'Faridkot', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Faridkot');
INSERT INTO parish (name, deanery_id) SELECT 'Badhni Mahafariste Wala', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Badhni Mahafariste Wala');
INSERT INTO parish (name, deanery_id) SELECT 'Ferozpur Canal Colony', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Ferozpur Canal Colony');
INSERT INTO parish (name, deanery_id) SELECT 'Ferozpur Cantt', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Ferozpur Cantt');
INSERT INTO parish (name, deanery_id) SELECT 'Ferozpur City', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Ferozpur City');
INSERT INTO parish (name, deanery_id) SELECT 'Gulami Wala', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Gulami Wala');
INSERT INTO parish (name, deanery_id) SELECT 'Guru Har Sahai', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Guru Har Sahai');
INSERT INTO parish (name, deanery_id) SELECT 'Lohgarh-Sur Singh Wala (Station)', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Lohgarh-Sur Singh Wala (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Mamdot', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Mamdot');
INSERT INTO parish (name, deanery_id) SELECT 'Mudki (Station)', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Mudki (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Sadiq', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Sadiq');
INSERT INTO parish (name, deanery_id) SELECT 'Talwandi Bhai', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Talwandi Bhai');
INSERT INTO parish (name, deanery_id) SELECT 'Tehna, Faridkot', d.id FROM deanery d WHERE d.name = 'Ferozpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Tehna, Faridkot');
INSERT INTO parish (name, deanery_id) SELECT 'Balun (Station)', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Balun (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Dalhousie', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dalhousie');
INSERT INTO parish (name, deanery_id) SELECT 'Dina Nagar', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dina Nagar');
INSERT INTO parish (name, deanery_id) SELECT 'Dorangala', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dorangala');
INSERT INTO parish (name, deanery_id) SELECT 'Gurdaspur', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Gurdaspur');
INSERT INTO parish (name, deanery_id) SELECT 'Jandwal, Pathankot', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jandwal, Pathankot');
INSERT INTO parish (name, deanery_id) SELECT 'Kahnuwan', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kahnuwan');
INSERT INTO parish (name, deanery_id) SELECT 'Narot Jaimal Singh (Station)', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Narot Jaimal Singh (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Pathankot City', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Pathankot City');
INSERT INTO parish (name, deanery_id) SELECT 'Puranashalla', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Puranashalla');
INSERT INTO parish (name, deanery_id) SELECT 'Sidhwan Jamita, Joura Chitra', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Sidhwan Jamita, Joura Chitra');
INSERT INTO parish (name, deanery_id) SELECT 'Sujanpur, Pathankot', d.id FROM deanery d WHERE d.name = 'Gurdaspur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Sujanpur, Pathankot');
INSERT INTO parish (name, deanery_id) SELECT 'Kakkon', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kakkon');
INSERT INTO parish (name, deanery_id) SELECT 'Baijnath', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Baijnath');
INSERT INTO parish (name, deanery_id) SELECT 'Balachaur', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Balachaur');
INSERT INTO parish (name, deanery_id) SELECT 'Bassi Bahian', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bassi Bahian');
INSERT INTO parish (name, deanery_id) SELECT 'Bhunga', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bhunga');
INSERT INTO parish (name, deanery_id) SELECT 'Gaggal', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Gaggal');
INSERT INTO parish (name, deanery_id) SELECT 'Garshankar', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Garshankar');
INSERT INTO parish (name, deanery_id) SELECT 'Jindwari', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jindwari');
INSERT INTO parish (name, deanery_id) SELECT 'Mehtiana, Khanaura', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Mehtiana, Khanaura');
INSERT INTO parish (name, deanery_id) SELECT 'Nandachaur', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Nandachaur');
INSERT INTO parish (name, deanery_id) SELECT 'Nangal', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Nangal');
INSERT INTO parish (name, deanery_id) SELECT 'Palampur', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Palampur');
INSERT INTO parish (name, deanery_id) SELECT 'Una', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Una');
INSERT INTO parish (name, deanery_id) SELECT 'Yol Camp', d.id FROM deanery d WHERE d.name = 'Hoshiarpur' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Yol Camp');
INSERT INTO parish (name, deanery_id) SELECT 'Apra', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Apra');
INSERT INTO parish (name, deanery_id) SELECT 'Banga (Station)', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Banga (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Behram (Station)', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Behram (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Dhina-Chittewani', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dhina-Chittewani');
INSERT INTO parish (name, deanery_id) SELECT 'Jalandhar Cantt', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jalandhar Cantt');
INSERT INTO parish (name, deanery_id) SELECT 'Jandiala Manjki', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jandiala Manjki');
INSERT INTO parish (name, deanery_id) SELECT 'Nawanshahar', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Nawanshahar');
INSERT INTO parish (name, deanery_id) SELECT 'Phagwara', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Phagwara');
INSERT INTO parish (name, deanery_id) SELECT 'Phulriwal', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Phulriwal');
INSERT INTO parish (name, deanery_id) SELECT 'Rawalpindi', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Rawalpindi');
INSERT INTO parish (name, deanery_id) SELECT 'Sansarpur', d.id FROM deanery d WHERE d.name = 'Jalandhar Cantt.' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Sansarpur');
INSERT INTO parish (name, deanery_id) SELECT 'Adampur', d.id FROM deanery d WHERE d.name = 'Jalandhar City' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Adampur');
INSERT INTO parish (name, deanery_id) SELECT 'Bootan', d.id FROM deanery d WHERE d.name = 'Jalandhar City' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bootan');
INSERT INTO parish (name, deanery_id) SELECT 'Chogitty', d.id FROM deanery d WHERE d.name = 'Jalandhar City' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Chogitty');
INSERT INTO parish (name, deanery_id) SELECT 'Gakhalan', d.id FROM deanery d WHERE d.name = 'Jalandhar City' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Gakhalan');
INSERT INTO parish (name, deanery_id) SELECT 'Jalandhar City', d.id FROM deanery d WHERE d.name = 'Jalandhar City' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jalandhar City');
INSERT INTO parish (name, deanery_id) SELECT 'Lambapind', d.id FROM deanery d WHERE d.name = 'Jalandhar City' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Lambapind');
INSERT INTO parish (name, deanery_id) SELECT 'Maqsudan', d.id FROM deanery d WHERE d.name = 'Jalandhar City' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Maqsudan');
INSERT INTO parish (name, deanery_id) SELECT 'Hussainpur- Lodhi Bhulana', d.id FROM deanery d WHERE d.name = 'Kapurthala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Hussainpur- Lodhi Bhulana');
INSERT INTO parish (name, deanery_id) SELECT 'Kapurthala', d.id FROM deanery d WHERE d.name = 'Kapurthala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kapurthala');
INSERT INTO parish (name, deanery_id) SELECT 'Kishangarh', d.id FROM deanery d WHERE d.name = 'Kapurthala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kishangarh');
INSERT INTO parish (name, deanery_id) SELECT 'Kartarpur', d.id FROM deanery d WHERE d.name = 'Kapurthala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kartarpur');
INSERT INTO parish (name, deanery_id) SELECT 'Mehatpur', d.id FROM deanery d WHERE d.name = 'Kapurthala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Mehatpur');
INSERT INTO parish (name, deanery_id) SELECT 'Nakodar', d.id FROM deanery d WHERE d.name = 'Kapurthala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Nakodar');
INSERT INTO parish (name, deanery_id) SELECT 'Shahkot', d.id FROM deanery d WHERE d.name = 'Kapurthala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Shahkot');
INSERT INTO parish (name, deanery_id) SELECT 'Sultanpur Lodhi', d.id FROM deanery d WHERE d.name = 'Kapurthala' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Sultanpur Lodhi');
INSERT INTO parish (name, deanery_id) SELECT 'BRS Nagar', d.id FROM deanery d WHERE d.name = 'Ludhiana' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'BRS Nagar');
INSERT INTO parish (name, deanery_id) SELECT 'Jagraon', d.id FROM deanery d WHERE d.name = 'Ludhiana' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jagraon');
INSERT INTO parish (name, deanery_id) SELECT 'Jalandhar Bypass, Ludhiana', d.id FROM deanery d WHERE d.name = 'Ludhiana' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jalandhar Bypass, Ludhiana');
INSERT INTO parish (name, deanery_id) SELECT 'Kidwai Nagar', d.id FROM deanery d WHERE d.name = 'Ludhiana' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kidwai Nagar');
INSERT INTO parish (name, deanery_id) SELECT 'Phillaur', d.id FROM deanery d WHERE d.name = 'Ludhiana' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Phillaur');
INSERT INTO parish (name, deanery_id) SELECT 'Raekot', d.id FROM deanery d WHERE d.name = 'Ludhiana' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Raekot');
INSERT INTO parish (name, deanery_id) SELECT 'Sarabha Nagar', d.id FROM deanery d WHERE d.name = 'Ludhiana' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Sarabha Nagar');
INSERT INTO parish (name, deanery_id) SELECT 'Baghapurana', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Baghapurana');
INSERT INTO parish (name, deanery_id) SELECT 'Buggipura, Moga (Station)', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Buggipura, Moga (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Buttar, Moga (Station)', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Buttar, Moga (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Dharamkot, Moga', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dharamkot, Moga');
INSERT INTO parish (name, deanery_id) SELECT 'Kot-Ise-Khan, Moga (Station)', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kot-Ise-Khan, Moga (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Makhu', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Makhu');
INSERT INTO parish (name, deanery_id) SELECT 'Moga', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Moga');
INSERT INTO parish (name, deanery_id) SELECT 'Nihal Singh Wala, Moga (Station)', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Nihal Singh Wala, Moga (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Singhanwala, Moga', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Singhanwala, Moga');
INSERT INTO parish (name, deanery_id) SELECT 'Takhtupura', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Takhtupura');
INSERT INTO parish (name, deanery_id) SELECT 'Zira', d.id FROM deanery d WHERE d.name = 'Moga' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Zira');
INSERT INTO parish (name, deanery_id) SELECT 'Abohar', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Abohar');
INSERT INTO parish (name, deanery_id) SELECT 'Bhagsar', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bhagsar');
INSERT INTO parish (name, deanery_id) SELECT 'Danewala', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Danewala');
INSERT INTO parish (name, deanery_id) SELECT 'Enakhera', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Enakhera');
INSERT INTO parish (name, deanery_id) SELECT 'Fazilka', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Fazilka');
INSERT INTO parish (name, deanery_id) SELECT 'Gidderbaha (Station)', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Gidderbaha (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Jaiton', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jaiton');
INSERT INTO parish (name, deanery_id) SELECT 'Jalalabad', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jalalabad');
INSERT INTO parish (name, deanery_id) SELECT 'Kotkapura', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Kotkapura');
INSERT INTO parish (name, deanery_id) SELECT 'Malout Pind', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Malout Pind');
INSERT INTO parish (name, deanery_id) SELECT 'Malout', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Malout');
INSERT INTO parish (name, deanery_id) SELECT 'Muktsar, Bir Sarkar', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Muktsar, Bir Sarkar');
INSERT INTO parish (name, deanery_id) SELECT 'Muktsar', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Muktsar');
INSERT INTO parish (name, deanery_id) SELECT 'Panjgaraian (Station)', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Panjgaraian (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Sikhwala', d.id FROM deanery d WHERE d.name = 'Muktsar' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Sikhwala');
INSERT INTO parish (name, deanery_id) SELECT 'Bhammian Kalan (Station)', d.id FROM deanery d WHERE d.name = 'Sahnewal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bhammian Kalan (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Jamalpur', d.id FROM deanery d WHERE d.name = 'Sahnewal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jamalpur');
INSERT INTO parish (name, deanery_id) SELECT 'Khanna', d.id FROM deanery d WHERE d.name = 'Sahnewal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Khanna');
INSERT INTO parish (name, deanery_id) SELECT 'Khanpur-Jassar-Sangowal-Rania', d.id FROM deanery d WHERE d.name = 'Sahnewal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Khanpur-Jassar-Sangowal-Rania');
INSERT INTO parish (name, deanery_id) SELECT 'Machhiwara', d.id FROM deanery d WHERE d.name = 'Sahnewal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Machhiwara');
INSERT INTO parish (name, deanery_id) SELECT 'Machian Khurd', d.id FROM deanery d WHERE d.name = 'Sahnewal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Machian Khurd');
INSERT INTO parish (name, deanery_id) SELECT 'Sahnewal', d.id FROM deanery d WHERE d.name = 'Sahnewal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Sahnewal');
INSERT INTO parish (name, deanery_id) SELECT 'Samrala', d.id FROM deanery d WHERE d.name = 'Sahnewal' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Samrala');
INSERT INTO parish (name, deanery_id) SELECT 'Bhogpur', d.id FROM deanery d WHERE d.name = 'Tanda' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bhogpur');
INSERT INTO parish (name, deanery_id) SELECT 'Bholath', d.id FROM deanery d WHERE d.name = 'Tanda' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bholath');
INSERT INTO parish (name, deanery_id) SELECT 'Dasuya', d.id FROM deanery d WHERE d.name = 'Tanda' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Dasuya');
INSERT INTO parish (name, deanery_id) SELECT 'Mukerian', d.id FROM deanery d WHERE d.name = 'Tanda' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Mukerian');
INSERT INTO parish (name, deanery_id) SELECT 'Tanda', d.id FROM deanery d WHERE d.name = 'Tanda' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Tanda');
INSERT INTO parish (name, deanery_id) SELECT 'Sri Hargobindpur', d.id FROM deanery d WHERE d.name = 'Tanda' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Sri Hargobindpur');
INSERT INTO parish (name, deanery_id) SELECT 'Akalgarh (Station)', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Akalgarh (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Beas', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Beas');
INSERT INTO parish (name, deanery_id) SELECT 'Bhikhiwind', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bhikhiwind');
INSERT INTO parish (name, deanery_id) SELECT 'Bhojian', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Bhojian');
INSERT INTO parish (name, deanery_id) SELECT 'Chabhal (Station)', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Chabhal (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Fatehabad (Station)', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Fatehabad (Station)');
INSERT INTO parish (name, deanery_id) SELECT 'Harike', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Harike');
INSERT INTO parish (name, deanery_id) SELECT 'Jandiala Guru', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Jandiala Guru');
INSERT INTO parish (name, deanery_id) SELECT 'Khem Karan', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Khem Karan');
INSERT INTO parish (name, deanery_id) SELECT 'Patti', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Patti');
INSERT INTO parish (name, deanery_id) SELECT 'Tarn Taran', d.id FROM deanery d WHERE d.name = 'Tarn Taran' AND NOT EXISTS (SELECT 1 FROM parish x WHERE x.deanery_id = d.id AND x.name = 'Tarn Taran');

-- 4) Verify (expect deanery=16, parish=154):
-- SELECT (SELECT COUNT(*) FROM deanery) AS deanery_rows, (SELECT COUNT(*) FROM parish) AS parish_rows;

-- =====================================================================================
-- DANGER - DESTRUCTIVE DELETE BLOCK - OFF BY DEFAULT - DO NOT ENABLE BLINDLY
-- The script above is additive and removes nothing. profile.parish / profile.deanery are
-- stored as STRINGS that may reference DB-only rows, so deleting extras can orphan data.
-- STEP 0 discovery found ZERO DB-only rows, so nothing here is required. If you ever must
-- prune, BACK UP first, audit references, then delete manually & intentionally.
-- =====================================================================================
