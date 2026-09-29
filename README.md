# خدمة تكاملات العرب الماسي

خدمة محلية/خلفية لقراءة البيانات من **Zid، WhatsApp Business Platform، Google Ads، Google Search Console** وكتابتها بشكل آمن إلى **Google Sheets**. لا تنفذ أي عمليات تعديل على الحملات أو المنتجات أو الطلبات أو المخزون ولا ترسل رسائل واتساب.

## المعمارية

- `src/connectors/zid` — الطلبات والمنتجات والمخزون.
- `src/connectors/whatsapp` — تحليلات WABA + دمج مؤشرات webhook المحلية بدون حفظ نصوص أو أرقام عملاء.
- `src/connectors/google-ads` — تقارير يومية على مستوى الحملة ومجموعة الإعلانات والكلمة المفتاحية.
- `src/connectors/search-console` — Search Analytics حسب التاريخ/الاستعلام/الصفحة/الجهاز/البلد.
- `src/connectors/google-sheets` — إنشاء التبويبات المملوكة للخدمة، upsert وعدم تكرار الصفوف، سجل التشغيل ولوحة المتابعة.
- `src/services/normalization` — التاريخ بتوقيت `Asia/Riyadh`، العملات، الأرقام، معرفات ثابتة وحالات الطلب.
- `src/services/validation` — التكرار، الحقول الرقمية، المفاتيح.
- `src/services/sync` — Retry/timeout، OAuth Google، lock، حالة التحديث التدريجي، orchestration.
- `src/services/logging` — إخفاء الأسرار من السجلات.
- `tests` — اختبارات أساسية مستقلة.

## المتطلبات المسبقة

- Node.js `22.6+` (المشروع يستخدم TypeScript strip-types المدمج لتجنب الاعتمادات الخارجية).
- صلاحية قراءة للمصادر، وصلاحية كتابة للـ Google Sheet المستهدف.
- لا يلزم `npm install` لهذا الإصدار.

## Google Sheet المستهدف

المعرف مضبوط محلياً على:

`1GtRjDlzEBy62EOjMBV9Zeyuj5vS-aR_hxlPtK2M_e1w`

التبويبات التي تديرها الخدمة:

- `زد`
- `واتساب`
- `أداء الإعلانات`
- `أداء البحث`
- `سجل التشغيل`

وتستخدم داخل `لوحة المتابعة` نطاقاً مخصصاً يبدأ من `J1` حتى لا تمس القسم التنفيذي الحالي في `A:H`. إذا وجد محتوى غير تابع للخدمة في هذا النطاق، تتوقف الكتابة إليه بدلاً من استبداله.

## متغيرات البيئة المطلوبة

انسخ `.env.example` إلى `.env`. لا تضع الأسرار في Git أو Google Sheets.

### Google OAuth

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

النطاقات المطلوبة بالحد الأدنى:

- Google Ads: `https://www.googleapis.com/auth/adwords`
- Search Console: `https://www.googleapis.com/auth/webmasters.readonly`
- Google Sheets: `https://www.googleapis.com/auth/spreadsheets`

يمكن استخدام OAuth client واحد وrefresh token واحد إذا تم منحه النطاقات الثلاثة في عملية التفويض.

### Google Ads

- `GOOGLE_ADS_CUSTOMER_ID`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` فقط إذا كان الوصول عبر MCC/Manager.
- `GOOGLE_ADS_API_VERSION=v25`
- `GOOGLE_ADS_DEVELOPER_TOKEN` اختياري للتوافق فقط. وفق وثائق Google الحالية، تم إنهاء الاعتماد على Developer Token في 9 سبتمبر 2026 ونقل مستوى الوصول إلى Google Cloud projects؛ يمكن أن يبقى الهيدر لكنه اختياري/متجاهل للحسابات المنقولة.

### Search Console

- `SEARCH_CONSOLE_SITE_URL` يجب أن يطابق الملكية حرفياً، مثال URL-prefix: `https://alarabalmasi.com/` أو Domain property: `sc-domain:alarabalmasi.com`.

### Zid

- `ZID_AUTHORIZATION_TOKEN`
- `ZID_MANAGER_TOKEN`
- `ZID_STORE_ID`

الصلاحيات المطلوبة للقراءة فقط: `orders.read` و`products.read`. يطلب Orders ترويسة `Authorization` و`X-Manager-Token`. تستخدم Products وStocks `Access-Token` (رمز المدير المباشر) و`Store-Id` و`Role: Manager`.

لإصدار `ZID_AUTHORIZATION_TOKEN` استخدم نطاق HTTPS مؤقتًا مجانيًا عبر Cloudflare Quick Tunnel، مثل `cloudflared tunnel --url http://127.0.0.1:8789`. سجّل العنوان الناتج مع `/oauth/callback` في تطبيق Zid وضعه في `ZID_REDIRECT_URI` داخل `.env`، مع إبقاء tunnel قيد التشغيل أثناء التفويض. استخدم `npm run auth:zid` لإكمال OAuth. يطلب الأمر Client ID وClient Secret من الطرفية دون إظهار المدخلات ولا يحفظ Client Secret؛ بعد الموافقة يحفظ Authorization token وManager Token وStore ID محليًا في `.env`. رابط Quick Tunnel مؤقت ويتغير عند إعادة تشغيله.

### WhatsApp Business Platform

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_WABA_ID`
- `WHATSAPP_GRAPH_VERSION` — يُحدد صراحة بدلاً من افتراض إصدار Graph قد يتغير.
- `WHATSAPP_APP_SECRET` موصى به للتحقق من توقيع webhook.
- `WHATSAPP_VERIFY_TOKEN` للتحقق الأولي من webhook.

مهم: WABA Analytics يوفر مقاييس الرسائل المرسلة/المسلّمة وتحليلات المحادثات. **المحادثات المفتوحة/المغلقة، وقت أول رد، وعدد الرسائل الواردة** ليست كلها متاحة كحالة صندوق وارد عبر Analytics وحده؛ لهذا يتضمن المشروع مستقبل webhook محلي يحفظ **مقاييس غير شخصية فقط** (hash للمعرف، اتجاه الرسالة، الوقت، الحالة) ولا يحفظ نص الرسالة أو رقم العميل. التحويلات المنسوبة إلى واتساب تبقى `null` ما لم تتوفر آلية attribution موثقة.

## أوامر التشغيل

```bash
npm run check:env
npm run auth:zid
npm run dry-run
npm test
npm run sync:all
npm run sync:zid
npm run sync:whatsapp
npm run sync:ads
npm run sync:search
npm run webhook:whatsapp
```

`dry-run` يستخدم Mock Data موسومة ولا يكتب إلى Google Sheets.

## التحديث التدريجي ومنع التكرار

- حالة آخر نجاح تحفظ محلياً في `data/state.json`.
- كل تشغيل يستخدم نافذة lookback قابلة للضبط مع ساعة تداخل لحماية البيانات المتأخرة.
- Google Sheets يستخدم مفتاح `key` ثابت لكل سجل وعمليات upsert؛ إعادة التشغيل لا تضيف صفاً مكرراً.
- الخدمة **لا تحذف الصفوف** ولا تمس التبويبات غير المملوكة لها.
- lock محلي `data/sync.lock` يمنع التشغيل المتزامن.

## Retry والمهل

- `HTTP_RETRY_COUNT` افتراضياً 3 محاولات إضافية.
- Backoff تدريجي للأخطاء `429` و`5xx`.
- `HTTP_TIMEOUT_MS` افتراضياً 20 ثانية.
- الأخطاء الدائمة `4xx` لا يعاد إرسالها تلقائياً.

## الجدولة

القيم المقترحة موجودة في `.env.example` ولا يتم تشغيل أي مجدول خارجي تلقائياً:

- Zid: كل ساعة.
- WhatsApp: كل ساعة، مع webhook عند توفر endpoint عام لاحقاً.
- Google Ads: يومياً 04:15.
- Search Console: يومياً 04:30.

يمكن ربط الأوامر لاحقاً بـ Windows Task Scheduler أو cron أو Cloud Scheduler بعد موافقة صريحة على بيئة النشر.

## اختبار الاتصال الحقيقي

بعد إدخال الأسرار:

1. `npm run check:env`
2. شغّل كل مصدر منفرداً أولاً.
3. راجع `سجل التشغيل` في Google Sheets.
4. شغّل `npm run sync:all`.

## معالجة الأعطال

- `401/403 Google`: تحقق من النطاقات، refresh token، وصلاحية المستخدم على الحساب/الملكية/الملف.
- `Google Ads USER_PERMISSION_DENIED`: تحقق من `GOOGLE_ADS_CUSTOMER_ID` و`GOOGLE_ADS_LOGIN_CUSTOMER_ID` إن كان الوصول عبر مدير.
- `Zid 401`: تحقق من Authorization وX-Manager-Token وStore ID والصلاحيات `orders.read/products.read`.
- WhatsApp بدون inbound/first response: شغّل webhook وتأكد من الاشتراك في أحداث الرسائل والحالات.
- خطأ Header mismatch في Sheets: الخدمة تتوقف حمايةً للبيانات ولا تعيد كتابة التبويب تلقائياً.
- ملف lock قديم: يزال تلقائياً بعد `LOCK_STALE_MS`.

## إضافة مصدر جديد

1. أنشئ `src/connectors/<source>/index.ts` وطبّق واجهة `Connector`.
2. أضف اسمه إلى `SourceName`.
3. عرّف التبويب وHeaders في Google Sheets connector.
4. سجله في `services/sync/index.ts`.
5. أضف Mock واختبارات التطبيع/التحقق قبل الربط الحقيقي.

## الوثائق الرسمية المستخدمة

- Zid Authorization: https://docs.zid.sa/authorization
- Zid Orders: https://docs.zid.sa/list-of-orders
- Zid Products: https://docs.zid.sa/retrieve-a-list-of-products
- Zid Product Stocks: https://docs.zid.sa/list-product-stocks
- WhatsApp Business Analytics: https://developers.facebook.com/docs/whatsapp/business-management-api/analytics
- Google Ads OAuth/Headers: https://developers.google.com/google-ads/api/rest/auth
- Google Ads OAuth scope: https://developers.google.com/google-ads/api/docs/oauth/internals
- Google Ads metrics: https://developers.google.com/google-ads/api/fields/v25/metrics
- Search Console Search Analytics: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- Google Sheets batch values: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate
- Google Sheets scopes: https://developers.google.com/workspace/sheets/api/scopes
