/* Veero — shared HSE & Quality catalog (browser: window.HSE, Node: require()).
   RISKS  : what the cameras can report.      [domain, fr, en, ar]
   ASSETS : what you track by hand in the register (things that expire / need a periodic check).
            [domain, fr, en, ar, suggested days until next check, hint fr, hint en]
   The suggested intervals are only defaults: adapt them to your supplier, your standard (ISO 45001, ISO 22000, HACCP plan)
   and the regulation that applies to your site. */
(function (root, factory) {
  const m = factory();
  if (typeof module === "object" && module.exports) module.exports = m; else root.HSE = m;
})(typeof self !== "undefined" ? self : this, function () {
  const DOMAINS = ["hse", "quality"];
  const DOMAIN = { hse: ["HSE", "HSE", "السلامة والبيئة"], quality: ["Qualité", "Quality", "الجودة"] };

  const RISKS = {
    // ---- HSE : hygiène, sécurité, environnement
    fire: ["hse", "Flamme / début d’incendie", "Flame / fire", "لهب / حريق"],
    smoke: ["hse", "Fumée", "Smoke", "دخان"],
    no_ppe: ["hse", "EPI manquant (casque, gilet, gants, lunettes)", "Missing PPE (helmet, vest, gloves, goggles)", "غياب معدات الوقاية"],
    fall: ["hse", "Chute / personne au sol", "Fall / person down", "سقوط / شخص على الأرض"],
    spill: ["hse", "Fuite ou déversement (glissade, chimique)", "Spill or leak (slip, chemical)", "تسرب أو انسكاب"],
    exit_blocked: ["hse", "Issue de secours ou extincteur obstrué", "Blocked exit or extinguisher", "مخرج طوارئ أو طفاية مسدودة"],
    restricted: ["hse", "Entrée en zone interdite / dangereuse", "Restricted-zone entry", "دخول منطقة محظورة"],
    vehicle: ["hse", "Chariot et piéton trop proches", "Forklift–pedestrian proximity", "مركبة ومشاة قريبون جدا"],
    height: ["hse", "Travail en hauteur sans harnais", "Work at height without harness", "عمل في العلو بدون حزام"],
    smoking: ["hse", "Fumeur en zone interdite", "Smoking in a prohibited area", "تدخين في منطقة محظورة"],
    // ---- Qualité : hygiène des produits, HACCP
    dirt: ["quality", "Saleté près du produit ou des aliments", "Dirt near product or food", "أوساخ قرب المنتج أو الغذاء"],
    foreign: ["quality", "Corps étranger sur la ligne / le produit", "Foreign object on line / product", "جسم غريب على الخط أو المنتج"],
    hygiene_ppe: ["quality", "Tenue d’hygiène manquante (charlotte, gants, tablier)", "Missing hygiene gear (hairnet, gloves, apron)", "غياب لباس النظافة"],
    floor_product: ["quality", "Produit au sol ou non protégé", "Product on the floor or uncovered", "منتج على الأرض أو مكشوف"],
    pest: ["quality", "Nuisible (rongeur, insecte)", "Pest (rodent, insect)", "آفة (قوارض، حشرات)"],
    cross: ["quality", "Contamination croisée (cru / cuit, propre / sale)", "Cross-contamination (raw / cooked, clean / dirty)", "تلوث متقاطع"],
    cold_chain: ["quality", "Chaîne du froid (porte ouverte, produit hors froid)", "Cold-chain break (open door, product out of cold)", "انقطاع سلسلة التبريد"],
    waste: ["quality", "Déchets qui débordent", "Overflowing waste", "نفايات متراكمة"],
    surface: ["quality", "Surface ou équipement sale", "Dirty surface or equipment", "سطح أو معدات غير نظيفة"],
    other: ["hse", "Autre risque", "Other risk", "خطر آخر"],
  };

  const ASSETS = {
    // ---- HSE
    extinguisher: ["hse", "Extincteur", "Fire extinguisher", "طفاية حريق", 365, "Vérification annuelle ; révision complète tous les 10 ans.", "Annual check; full overhaul every 10 years."],
    ria: ["hse", "RIA (robinet d’incendie armé)", "Fire hose reel", "خرطوم إطفاء", 365, "Contrôle fonctionnel périodique.", "Periodic functional check."],
    fire_alarm: ["hse", "Alarme / détecteur incendie", "Fire alarm / detector", "إنذار / كاشف حريق", 365, "Test et vérification périodiques.", "Periodic test and check."],
    electrical: ["hse", "Vérification des installations électriques", "Electrical installation check", "فحص التركيبات الكهربائية", 365, "Vérification périodique annuelle par un organisme compétent.", "Annual periodic check by a competent body."],
    first_aid: ["hse", "Trousse de premiers secours", "First-aid kit", "حقيبة إسعافات أولية", 180, "Contrôler les dates de péremption du contenu.", "Check the expiry dates of the contents."],
    eyewash: ["hse", "Douche / lave-œil de sécurité", "Safety shower / eyewash", "دش / غسالة عيون", 30, "Test de fonctionnement régulier.", "Regular function test."],
    ppe: ["hse", "EPI (casque, harnais, gants…)", "PPE (helmet, harness, gloves…)", "معدات الوقاية الشخصية", 365, "Durée de vie et contrôle selon le fabricant.", "Lifetime and inspection per manufacturer."],
    lifting: ["hse", "Appareil de levage / chariot", "Lifting equipment / forklift", "معدات رفع / رافعة شوكية", 365, "Vérification périodique réglementaire.", "Regulatory periodic inspection."],
    training: ["hse", "Formation / habilitation sécurité", "Safety training / authorization", "تكوين / ترخيص السلامة", 365, "Recyclage à prévoir avant l’échéance.", "Plan refresher before the deadline."],
    other_hse: ["hse", "Autre équipement HSE", "Other HSE item", "معدة أخرى للسلامة", 365, "", ""],
    // ---- Qualité
    food_lot: ["quality", "Lot / matière première (DLC / DLUO)", "Lot / raw material (use-by date)", "دفعة / مادة أولية (تاريخ الصلاحية)", 30, "Date limite de consommation ou d’utilisation optimale.", "Use-by or best-before date."],
    probe: ["quality", "Sonde / thermomètre (étalonnage)", "Probe / thermometer (calibration)", "مسبار / ميزان حرارة (معايرة)", 365, "Étalonnage périodique des instruments de mesure.", "Periodic calibration of measuring instruments."],
    instrument: ["quality", "Instrument de mesure (balance, pH-mètre)", "Measuring instrument (scale, pH meter)", "جهاز قياس (ميزان، pH)", 365, "Étalonnage ou vérification.", "Calibration or verification."],
    pest_control: ["quality", "Dératisation / désinsectisation", "Pest-control service", "مكافحة القوارض والحشرات", 90, "Prochaine visite prévue au contrat.", "Next visit under the contract."],
    water_test: ["quality", "Analyse d’eau / microbiologique", "Water / microbiological test", "تحليل الماء / ميكروبيولوجي", 90, "Fréquence selon votre plan HACCP.", "Frequency per your HACCP plan."],
    certificate: ["quality", "Certificat / audit (ISO 22000, ISO 9001, HACCP)", "Certificate / audit (ISO 22000, ISO 9001, HACCP)", "شهادة / تدقيق (ISO 22000، ISO 9001)", 1095, "Une certification ISO est valable 3 ans, avec audits de suivi.", "An ISO certificate is valid for 3 years, with surveillance audits."],
    cleaning_check: ["quality", "Contrôle du plan de nettoyage / désinfection", "Cleaning & disinfection check", "مراقبة خطة التنظيف والتطهير", 30, "", ""],
    other_quality: ["quality", "Autre contrôle qualité", "Other quality item", "عنصر جودة آخر", 90, "", ""],
  };

  const I = { fr: 1, en: 2, ar: 3 };
  const pick = (map, k, l) => { const r = map[k]; return r ? r[I[l] || 1] : k; };
  const riskLabel = (k, l) => pick(RISKS, k, l);
  const assetLabel = (k, l) => pick(ASSETS, k, l);
  const domainLabel = (k, l) => { const r = DOMAIN[k]; return r ? r[(I[l] || 1) - 1] : k; };
  const riskDomain = (k) => (RISKS[k] ? RISKS[k][0] : "hse");
  const assetsOf = (domain) => Object.keys(ASSETS).filter((k) => ASSETS[k][0] === domain);
  const risksOf = (domain) => Object.keys(RISKS).filter((k) => RISKS[k][0] === domain && k !== "other");
  const assetDays = (k) => (ASSETS[k] ? ASSETS[k][4] : 365);
  const assetHint = (k, l) => (ASSETS[k] ? ASSETS[k][l === "en" ? 6 : 5] || "" : "");

  /* dates are plain YYYY-MM-DD strings; "today" is computed in the site's timezone */
  const ymd = (d, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(d || new Date());
  const daysLeft = (expires, today) => Math.round((Date.parse(expires + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5);
  /* -> { days, state: "expired" | "soon" | "ok" } */
  function assetState(a, today) {
    const days = daysLeft(a.expires_on, today);
    const r = a.remind_days == null ? 30 : +a.remind_days;
    return { days, state: days < 0 ? "expired" : days <= r ? "soon" : "ok" };
  }
  const addDays = (ymdStr, n) => new Date(Date.parse(ymdStr + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

  return { DOMAINS, DOMAIN, RISKS, ASSETS, riskLabel, assetLabel, domainLabel, riskDomain, assetsOf, risksOf, assetDays, assetHint, ymd, daysLeft, assetState, addDays };
});
