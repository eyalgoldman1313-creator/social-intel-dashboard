# לוח מודיעין תחרותי – סושיאל ופרסום (Hebrew RTL dashboard)

אתר סטטי, ללא תלויות. `npm run build` קורא את `data/data.json` ומייצר `dist/`.

## עדכון שבועי
1. פתחו `data/data.json` → מערך `scans`.
2. העתיקו את האובייקט האחרון, שנו `id` (YYYY-MM-DD), `date`, `statusLabel`, ועדכנו מספרים/קישורי Drive.
3. `npm run build` ← הדף הראשי מציג את הסריקה האחרונה, מסמן Δ מול הקודמת, והקודמות נשמרות ב-`/archive/<id>/`.

מותגים (`brands`) ואירועים (`events`) מוגדרים פעם אחת. הלוח מציג רק מספרים שמופיעים בדוחות – אין להמציא נתונים.
פונט: Heebo (Google Fonts CDN, ללא סקריפטים). ללא אנליטיקה/מעקב/עוגיות. `noindex`.

## קריאייטיבים, Top 10 וייבוא נכסים

- הלשוניות הראשונות: **קריאייטיבים חזקים** (גלריה עם סינון/מיון/הגדלה) ו-**Top 10 השבוע** (סטוריבורד שבועי, צילומי מצב לפי שבוע ISO ב-`data/top10.json`).
- הנתונים נוצרים מתיקיית הנכסים של הבוטים (`/workspace/social/creatives/{meta,tiktok,organic}/index.json`) ע״י: `node scripts/import-creatives.mjs [srcDir] [--asof YYYY-MM-DD]`. הסקריפט מכווץ תמונות ל-WebP (עד 150KB, דורש python3+Pillow), כותב `public/creatives/**`, `data/creatives.json` ו-`data/top10.json`. את התוצאה מבצעים commit – ה-build עצמו (`npm run build`) לא דורש תלויות.
- שדות נתמכים ב-index.json: `brand, library_id, file, format, platform, start_date, days_active, status, copy_text, cta, offer, creative_notes, library_url, variants_count, family` (Meta); `brand, video_url|post_url, file, post_date, days_since_posted, views, likes, comments, shares, type, hook, creative_notes, language` (TikTok/אורגני).
- דירוג Top 10 של מודעות Meta: ותק ריצה, אח״כ מספר גרסאות (עד 2 למותג). תוכן אורגני מדורג בנפרד לפי צפיות ומסומן בבירור.

## דפי אפיון (אפיון / תסריט ל-Nully / מיילרים) – לבוטים
- קבצי HTML מלאים נשמרים ב-`specs/` (רק גרסת v2/האחרונה). ה-build מעתיק אותם ל-`dist/specs/` ומוסיף פס עליון "חזרה ללוח" – התוכן עצמו לא משתנה. כתובת: `/specs/<שם-קובץ-בלי-.html>` (cleanUrls).
- המיפוי ב-`data/specs.json`:
  - `items`: מפתח = מזהה ספריית Meta (`library_id`) או מזהה הווידאו המספרי שב-`post_url` (TikTok). ערך = מערך `{ "label": "אפיון" | "תסריט ל-Nully", "file": "<קובץ ב-specs/>" }`.
  - `mailers`: מערך `{ brand, title, file }` – מוצג בלשונית **מיילרים**.
- הוספת אפיון חדש: (1) העתיקו את הקובץ ל-`specs/` בשם `meta-<brand>-<id>.html` / `tiktok-<brand>-<id>-spec.html` / `-nully.html` / `mailer-<brand>.html`; (2) הוסיפו רשומה ב-`data/specs.json`; (3) `npm run build` ובדקו ש-`data-spec="1"` מופיע; commit + push ל-main.
- כרטיסים עם אפיון מקבלים תגית סגולה בגלריה וב-Top 10, ויש סינון "עם אפיון" בגלריה. מזהה ללא כרטיס תואם פשוט לא יוצג (בדקו ב-`data/creatives.json`).
