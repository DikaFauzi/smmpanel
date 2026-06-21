const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const session = require("express-session");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();
const APP_NAME = "DK PANEL";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
    secret: "smmsecret",
    resave: false,
    saveUninitialized: false
}));

app.use((req, res, next) => {
    res.locals.appName = APP_NAME;
    res.locals.currentPath = req.path;
    res.locals.user = req.session.user || null;
    next();
});

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "smmpanel"
});



// =====================
// SALES REPORT SUPPORT
// =====================
function ensureSalesReportSchema(callback) {
    const done = typeof callback === 'function' ? callback : function(){};

    db.query('SHOW COLUMNS FROM orders', (err, rows) => {
        if (err) {
            console.log('Sales report schema check skipped:', err.message);
            return done(err);
        }

        const existingColumns = new Set((rows || []).map(row => row.Field));
        const requiredColumns = [
            { name: 'created_at', sql: 'ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updated_at', sql: 'ALTER TABLE orders ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL' },
            { name: 'refunded_at', sql: 'ALTER TABLE orders ADD COLUMN refunded_at TIMESTAMP NULL DEFAULT NULL' }
        ].filter(column => !existingColumns.has(column.name));

        const runAlter = (index = 0) => {
            if (index >= requiredColumns.length) return done();
            const column = requiredColumns[index];
            db.query(column.sql, (alterErr) => {
                if (alterErr) {
                    console.log('Sales report column add skipped:', column.name, alterErr.message);
                }
                runAlter(index + 1);
            });
        };

        runAlter();
    });
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
}

function parseOrderDate(value) {
    if (!value) return new Date();
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function buildSalesPeriodKey(date, mode) {
    const d = parseOrderDate(date);
    const year = d.getFullYear();
    const month = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());

    if (mode === 'yearly') return String(year);
    if (mode === 'monthly') return `${year}-${month}`;
    if (mode === 'weekly') {
        const week = getISOWeek(d);
        return `${week.year}-W${pad2(week.week)}`;
    }
    return `${year}-${month}-${day}`;
}

function buildSalesSeries(rows, mode) {
    const bucket = new Map();
    (rows || []).forEach(row => {
        const key = buildSalesPeriodKey(row.created_at, mode);
        if (!bucket.has(key)) {
            bucket.set(key, { period: key, revenue: 0, orders: 0, quantity: 0 });
        }
        const item = bucket.get(key);
        item.revenue += Number(row.total || 0);
        item.orders += 1;
        item.quantity += Number(row.jumlah || 0);
    });

    return Array.from(bucket.values())
        .sort((a, b) => String(a.period).localeCompare(String(b.period)))
        .map(item => ({
            period: item.period,
            revenue: Math.round(item.revenue),
            orders: item.orders,
            quantity: item.quantity
        }));
}

function topSalesServices(rows, limit = 8) {
    const bucket = new Map();
    (rows || []).forEach(row => {
        const serviceName = row.nama || 'Layanan tidak ditemukan';
        const key = `${row.service_id || 0}-${serviceName}`;
        if (!bucket.has(key)) {
            bucket.set(key, {
                service_id: row.service_id || 0,
                nama: serviceName,
                kategori: row.kategori || '-',
                revenue: 0,
                orders: 0,
                quantity: 0
            });
        }
        const item = bucket.get(key);
        item.revenue += Number(row.total || 0);
        item.orders += 1;
        item.quantity += Number(row.jumlah || 0);
    });

    return Array.from(bucket.values())
        .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
        .slice(0, limit)
        .map(item => ({ ...item, revenue: Math.round(item.revenue) }));
}

db.connect((err) => {
    if (err) {
        console.log("Database error:", err);
    } else {
        console.log("Database Connected");
        ensureServiceMetadataColumns();
        ensureManualDepositSchema();
        ensureRefillSchema();
        ensureSalesReportSchema();
        setTimeout(seedDefaultOrderServices, 700);
    }
});


const DEFAULT_PAYMENT_METHODS = [
    { name: 'QRIS 24 Jam', type: 'QRIS', account_name: 'DK PANEL', account_number: 'Scan QRIS / upload bukti transfer', qr_label: 'QRIS', min_amount: 10000, max_amount: 10000000, fee_fixed: 750, fee_percent: 0.7, sort_order: 1 },
    { name: 'Bank BCA', type: 'BANK', account_name: 'DK PANEL', account_number: '1234567890', qr_label: 'BCA', min_amount: 10000, max_amount: 50000000, fee_fixed: 0, fee_percent: 0, sort_order: 2 },
    { name: 'Bank BRI', type: 'BANK', account_name: 'DK PANEL', account_number: '1234567890', qr_label: 'BRI', min_amount: 10000, max_amount: 50000000, fee_fixed: 0, fee_percent: 0, sort_order: 3 },
    { name: 'Bank BNI', type: 'BANK', account_name: 'DK PANEL', account_number: '1234567890', qr_label: 'BNI', min_amount: 10000, max_amount: 50000000, fee_fixed: 0, fee_percent: 0, sort_order: 4 },
    { name: 'Bank Mandiri', type: 'BANK', account_name: 'DK PANEL', account_number: '1234567890', qr_label: 'MDR', min_amount: 10000, max_amount: 50000000, fee_fixed: 0, fee_percent: 0, sort_order: 5 },
    { name: 'DANA', type: 'EWALLET', account_name: 'DK PANEL', account_number: '6281234567890', qr_label: 'DANA', min_amount: 10000, max_amount: 10000000, fee_fixed: 0, fee_percent: 0, sort_order: 6 },
    { name: 'OVO', type: 'EWALLET', account_name: 'DK PANEL', account_number: '6281234567890', qr_label: 'OVO', min_amount: 10000, max_amount: 10000000, fee_fixed: 0, fee_percent: 0, sort_order: 7 },
    { name: 'GoPay', type: 'EWALLET', account_name: 'DK PANEL', account_number: '6281234567890', qr_label: 'GPAY', min_amount: 10000, max_amount: 10000000, fee_fixed: 0, fee_percent: 0, sort_order: 8 },
    { name: 'ShopeePay', type: 'EWALLET', account_name: 'DK PANEL', account_number: '6281234567890', qr_label: 'SPAY', min_amount: 10000, max_amount: 10000000, fee_fixed: 0, fee_percent: 0, sort_order: 9 }
];

function ensureManualDepositSchema(callback) {
    const done = typeof callback === 'function' ? callback : function(){};

    db.query(`
        CREATE TABLE IF NOT EXISTS payment_methods (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            type VARCHAR(40) NOT NULL DEFAULT 'BANK',
            account_name VARCHAR(120) DEFAULT '',
            account_number VARCHAR(180) DEFAULT '',
            qr_label VARCHAR(60) DEFAULT '',
            min_amount DECIMAL(15,2) DEFAULT 10000,
            max_amount DECIMAL(15,2) DEFAULT 10000000,
            fee_fixed DECIMAL(15,2) DEFAULT 0,
            fee_percent DECIMAL(8,4) DEFAULT 0,
            is_active TINYINT(1) DEFAULT 1,
            sort_order INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `, (methodErr) => {
        if (methodErr) {
            console.log('Payment method schema create failed:', methodErr.message);
            return done(methodErr);
        }

        db.query('SHOW COLUMNS FROM payment_methods', (showMethodErr, methodRows) => {
            if (showMethodErr) {
                console.log('Payment method columns check failed:', showMethodErr.message);
                return done(showMethodErr);
            }

            const existingMethodColumns = new Set((methodRows || []).map(row => row.Field));
            const methodColumns = [
                { name: 'name', sql: "ALTER TABLE payment_methods ADD COLUMN name VARCHAR(120) NOT NULL DEFAULT ''" },
                { name: 'type', sql: "ALTER TABLE payment_methods ADD COLUMN type VARCHAR(40) NOT NULL DEFAULT 'BANK'" },
                { name: 'account_name', sql: "ALTER TABLE payment_methods ADD COLUMN account_name VARCHAR(120) DEFAULT ''" },
                { name: 'account_number', sql: "ALTER TABLE payment_methods ADD COLUMN account_number VARCHAR(180) DEFAULT ''" },
                { name: 'qr_label', sql: "ALTER TABLE payment_methods ADD COLUMN qr_label VARCHAR(60) DEFAULT ''" },
                { name: 'min_amount', sql: "ALTER TABLE payment_methods ADD COLUMN min_amount DECIMAL(15,2) DEFAULT 10000" },
                { name: 'max_amount', sql: "ALTER TABLE payment_methods ADD COLUMN max_amount DECIMAL(15,2) DEFAULT 10000000" },
                { name: 'fee_fixed', sql: "ALTER TABLE payment_methods ADD COLUMN fee_fixed DECIMAL(15,2) DEFAULT 0" },
                { name: 'fee_percent', sql: "ALTER TABLE payment_methods ADD COLUMN fee_percent DECIMAL(8,4) DEFAULT 0" },
                { name: 'is_active', sql: "ALTER TABLE payment_methods ADD COLUMN is_active TINYINT(1) DEFAULT 1" },
                { name: 'sort_order', sql: "ALTER TABLE payment_methods ADD COLUMN sort_order INT DEFAULT 0" },
                { name: 'created_at', sql: "ALTER TABLE payment_methods ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP" }
            ].filter(column => !existingMethodColumns.has(column.name));

            const runMethodAlter = (index = 0) => {
                if (index >= methodColumns.length) {
                    return ensureDepositTablesAndSeedMethods(done);
                }

                const column = methodColumns[index];
                db.query(column.sql, (alterErr) => {
                    if (alterErr) {
                        console.log('Payment method column add skipped:', column.name, alterErr.message);
                    }
                    runMethodAlter(index + 1);
                });
            };

            runMethodAlter();
        });
    });
}

function ensureDepositTablesAndSeedMethods(done) {
    db.query(`
        CREATE TABLE IF NOT EXISTS deposits (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            amount DECIMAL(15,2) NOT NULL DEFAULT 0,
            metode VARCHAR(180) DEFAULT '',
            payment_method_id INT NULL,
            payment_type VARCHAR(40) DEFAULT '',
            total_pay DECIMAL(15,2) DEFAULT 0,
            fee_amount DECIMAL(15,2) DEFAULT 0,
            unique_code INT DEFAULT 0,
            proof_image VARCHAR(255) DEFAULT '',
            status VARCHAR(30) NOT NULL DEFAULT 'Pending',
            admin_note TEXT NULL,
            processed_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_deposit_user (user_id),
            INDEX idx_deposit_status (status)
        )
    `, (depositCreateErr) => {
        if (depositCreateErr) {
            console.log('Deposit schema create failed:', depositCreateErr.message);
            return done(depositCreateErr);
        }

        db.query('SHOW COLUMNS FROM deposits', (showDepositErr, rows) => {
            if (showDepositErr) {
                console.log('Deposit columns check failed:', showDepositErr.message);
                return done(showDepositErr);
            }

            const existing = new Set((rows || []).map(row => row.Field));
            const columns = [
                { name: 'user_id', sql: 'ALTER TABLE deposits ADD COLUMN user_id INT NOT NULL DEFAULT 0' },
                { name: 'amount', sql: 'ALTER TABLE deposits ADD COLUMN amount DECIMAL(15,2) NOT NULL DEFAULT 0' },
                { name: 'metode', sql: "ALTER TABLE deposits ADD COLUMN metode VARCHAR(180) DEFAULT ''" },
                { name: 'payment_method_id', sql: 'ALTER TABLE deposits ADD COLUMN payment_method_id INT NULL' },
                { name: 'payment_type', sql: "ALTER TABLE deposits ADD COLUMN payment_type VARCHAR(40) DEFAULT ''" },
                { name: 'total_pay', sql: 'ALTER TABLE deposits ADD COLUMN total_pay DECIMAL(15,2) DEFAULT 0' },
                { name: 'fee_amount', sql: 'ALTER TABLE deposits ADD COLUMN fee_amount DECIMAL(15,2) DEFAULT 0' },
                { name: 'unique_code', sql: 'ALTER TABLE deposits ADD COLUMN unique_code INT DEFAULT 0' },
                { name: 'proof_image', sql: "ALTER TABLE deposits ADD COLUMN proof_image VARCHAR(255) DEFAULT ''" },
                { name: 'status', sql: "ALTER TABLE deposits ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'Pending'" },
                { name: 'admin_note', sql: 'ALTER TABLE deposits ADD COLUMN admin_note TEXT NULL' },
                { name: 'processed_at', sql: 'ALTER TABLE deposits ADD COLUMN processed_at TIMESTAMP NULL DEFAULT NULL' },
                { name: 'created_at', sql: 'ALTER TABLE deposits ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }
            ].filter(column => !existing.has(column.name));

            const runDepositAlter = (index = 0) => {
                if (index >= columns.length) {
                    return seedPaymentMethods(done);
                }

                const column = columns[index];
                db.query(column.sql, (alterErr) => {
                    if (alterErr) {
                        console.log('Deposit column add skipped:', column.name, alterErr.message);
                    }
                    runDepositAlter(index + 1);
                });
            };

            runDepositAlter();
        });
    });
}

function seedPaymentMethods(done) {
    db.query('SELECT COUNT(*) AS total FROM payment_methods', (countErr, countRows) => {
        if (countErr) {
            console.log('Payment method seed count failed:', countErr.message);
            return done(countErr);
        }

        if (Number(countRows && countRows[0] && countRows[0].total || 0) > 0) {
            return done();
        }

        const insertNext = (index = 0) => {
            if (index >= DEFAULT_PAYMENT_METHODS.length) {
                return done();
            }

            const method = DEFAULT_PAYMENT_METHODS[index];
            db.query(
                `INSERT INTO payment_methods
                (name, type, account_name, account_number, qr_label, min_amount, max_amount, fee_fixed, fee_percent, is_active, sort_order)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
                [method.name, method.type, method.account_name, method.account_number, method.qr_label, method.min_amount, method.max_amount, method.fee_fixed, method.fee_percent, 1, method.sort_order],
                (insertErr) => {
                    if (insertErr) {
                        console.log('Payment method seed skipped:', method.name, insertErr.message);
                    }
                    insertNext(index + 1);
                }
            );
        };

        insertNext();
    });
}

function getActivePaymentMethods(callback) {
    ensureManualDepositSchema((schemaErr) => {
        if (schemaErr) {
            return callback(schemaErr, []);
        }

        db.query(
            `SELECT * FROM payment_methods WHERE is_active=1 ORDER BY sort_order ASC, id ASC`,
            (err, methods) => callback(err, methods || [])
        );
    });
}

function calculateDepositTotal(amount, method, userId) {
    const depositAmount = Math.max(0, Number(amount || 0));
    const feeFixed = Math.max(0, Number(method && method.fee_fixed || 0));
    const feePercent = Math.max(0, Number(method && method.fee_percent || 0));
    const percentageFee = Math.ceil((depositAmount * feePercent) / 100);
    const feeAmount = feeFixed + percentageFee;
    const methodId = Number(method && method.id || 0);
    const uid = Number(userId || 0);
    const todaySeed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    const uniqueCode = 100 + Math.abs((depositAmount * 7 + methodId * 53 + uid * 37 + todaySeed) % 900);
    const totalPay = depositAmount + feeAmount + uniqueCode;

    return { depositAmount, feeAmount, uniqueCode, totalPay };
}

function renderDepositWithError(res, req, error) {
    getActivePaymentMethods((methodErr, paymentMethods) => {
        res.render('deposit', {
            error: error || (methodErr ? 'Gagal mengambil metode pembayaran' : null),
            paymentMethods: paymentMethods || []
        });
    });
}

function ensureServiceMetadataColumns() {
    const columns = [
        { name: "deskripsi", sql: "ALTER TABLE services ADD COLUMN deskripsi TEXT NULL" },
        { name: "target_hint", sql: "ALTER TABLE services ADD COLUMN target_hint TEXT NULL" },
        { name: "avg_order_count", sql: "ALTER TABLE services ADD COLUMN avg_order_count INT DEFAULT 0" },
        { name: "avg_time_text", sql: "ALTER TABLE services ADD COLUMN avg_time_text VARCHAR(120) DEFAULT ''" },
        { name: "rating", sql: "ALTER TABLE services ADD COLUMN rating DECIMAL(3,2) DEFAULT 5.00" },
        { name: "rating_count", sql: "ALTER TABLE services ADD COLUMN rating_count INT DEFAULT 0" },
        { name: "refill_label", sql: "ALTER TABLE services ADD COLUMN refill_label VARCHAR(80) DEFAULT 'No Refill'" },
        { name: "speed_label", sql: "ALTER TABLE services ADD COLUMN speed_label VARCHAR(120) DEFAULT ''" },
        { name: "quality_label", sql: "ALTER TABLE services ADD COLUMN quality_label VARCHAR(120) DEFAULT ''" },
        { name: "start_time", sql: "ALTER TABLE services ADD COLUMN start_time VARCHAR(120) DEFAULT ''" }
    ];

    db.query("SHOW COLUMNS FROM services", (err, rows) => {
        if (err) {
            console.log("Service metadata check skipped:", err.message);
            return;
        }

        const existing = new Set((rows || []).map(row => row.Field));
        columns.forEach(column => {
            if (existing.has(column.name)) {
                return;
            }

            db.query(column.sql, alterErr => {
                if (alterErr) {
                    console.log("Service metadata column add failed:", column.name, alterErr.message);
                    return;
                }

                console.log("Service metadata column added:", column.name);
            });
        });
    });
}


function ensureRefillSchema(callback) {
    const done = typeof callback === 'function' ? callback : function(){};

    db.query(`
        CREATE TABLE IF NOT EXISTS refill_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            order_id INT NOT NULL,
            service_id INT NULL,
            target TEXT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'Proses',
            note TEXT NULL,
            admin_note TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_refill_user (user_id),
            INDEX idx_refill_order (order_id),
            INDEX idx_refill_status (status)
        )
    `, (createErr) => {
        if (createErr) {
            console.log('Refill schema create failed:', createErr.message);
            return done(createErr);
        }

        db.query('SHOW COLUMNS FROM refill_requests', (showErr, rows) => {
            if (showErr) {
                console.log('Refill schema column check failed:', showErr.message);
                return done(showErr);
            }

            const existing = new Set((rows || []).map(row => row.Field));
            const missingColumns = [
                { name: 'user_id', sql: 'ALTER TABLE refill_requests ADD COLUMN user_id INT NOT NULL DEFAULT 0' },
                { name: 'order_id', sql: 'ALTER TABLE refill_requests ADD COLUMN order_id INT NOT NULL DEFAULT 0' },
                { name: 'service_id', sql: 'ALTER TABLE refill_requests ADD COLUMN service_id INT NULL' },
                { name: 'target', sql: 'ALTER TABLE refill_requests ADD COLUMN target TEXT NULL' },
                { name: 'status', sql: "ALTER TABLE refill_requests ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'Proses'" },
                { name: 'note', sql: 'ALTER TABLE refill_requests ADD COLUMN note TEXT NULL' },
                { name: 'admin_note', sql: 'ALTER TABLE refill_requests ADD COLUMN admin_note TEXT NULL' },
                { name: 'created_at', sql: 'ALTER TABLE refill_requests ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
                { name: 'updated_at', sql: 'ALTER TABLE refill_requests ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP' }
            ].filter(column => !existing.has(column.name));

            const runAlter = (index = 0) => {
                if (index >= missingColumns.length) {
                    return done();
                }

                const column = missingColumns[index];
                db.query(column.sql, (alterErr) => {
                    if (alterErr) {
                        console.log('Refill schema column add skipped:', column.name, alterErr.message);
                    } else {
                        console.log('Refill schema column added:', column.name);
                    }
                    runAlter(index + 1);
                });
            };

            runAlter();
        });
    });
}

function isRefillEligibleLabel(label) {
    const value = String(label || '').toLowerCase();
    return value && !value.includes('no refill') && !value.includes('non refill');
}

function normalizeRefillStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    if (['selesai', 'success', 'completed'].includes(value)) return 'Selesai';
    if (['ditolak', 'rejected', 'batal', 'canceled'].includes(value)) return 'Ditolak';
    return 'Proses';
}

function serviceFallbackMeta(service) {
    const id = Number(service && service.id || 0);
    const avgOrder = Number(service && service.avg_order_count || 0) || (id % 240 + 25);
    const avgTime = String(service && service.avg_time_text || '').trim() || `${id % 9 + 1} jam ${id % 58 + 1} menit`;
    const rating = Math.max(0, Math.min(5, Number(service && service.rating || 5)));
    const ratingCount = Number(service && service.rating_count || 0) || (id % 12 + 2);
    const description = String(service && service.deskripsi || '').trim() || [
        service && service.speed_label ? service.speed_label : 'Speed 5-20K/days',
        service && service.quality_label ? service.quality_label : 'LOW QUALITY',
        service && service.refill_label ? service.refill_label : 'No refill'
    ].filter(Boolean).join('\n');

    return {
        avgOrder,
        avgTime,
        rating,
        ratingCount,
        description
    };
}

function cleanText(value, fallback = '') {
    return String(value || fallback).trim();
}


function cleanNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

const ORDER_SERVICE_FILTER_SQL = `
    status='active'
    AND (
        LOWER(kategori) LIKE '%instagram%'
        OR LOWER(kategori) LIKE '%tiktok%'
        OR LOWER(nama) LIKE '%instagram%'
        OR LOWER(nama) LIKE '%tiktok%'
    )
`;

const DEFAULT_ORDER_SERVICES = [
    {
        nama: 'Instagram Followers Indonesia [ No Refill ]',
        kategori: 'Instagram',
        harga: 10000,
        min_order: 100,
        max_order: 100000,
        status: 'active',
        deskripsi: 'Followers Instagram Indonesia untuk kebutuhan social proof. Pastikan username/link target benar sebelum order. No refill.',
        target_hint: 'Masukkan username Instagram tanpa @ atau link profile Instagram.',
        avg_order_count: 69,
        avg_time_text: '2 jam 30 menit 26 detik',
        rating: 5,
        rating_count: 2,
        refill_label: 'No Refill',
        speed_label: 'Speed 5-20K/days',
        quality_label: 'Indonesia / Mix Quality',
        start_time: '0-15 menit'
    },
    {
        nama: 'TikTok Views Indonesia [ Instant Start ]',
        kategori: 'TikTok',
        harga: 15000,
        min_order: 1000,
        max_order: 1000000,
        status: 'active',
        deskripsi: 'Views TikTok untuk link video. Cocok untuk bantu menaikkan exposure konten. Pastikan video public.',
        target_hint: 'Masukkan link video TikTok, bukan username profile.',
        avg_order_count: 233,
        avg_time_text: '5 jam 40 menit 54 detik',
        rating: 5,
        rating_count: 0,
        refill_label: 'No Refill',
        speed_label: 'Fast Start',
        quality_label: 'Views / Public Video',
        start_time: '0-30 menit'
    }
];

function seedDefaultOrderServices() {
    db.query('SHOW COLUMNS FROM services', (columnErr, columns) => {
        if (columnErr) {
            console.log('Default service seed skipped:', columnErr.message);
            return;
        }

        const existingColumns = new Set((columns || []).map(row => row.Field));
        const allowedColumns = [
            'nama', 'kategori', 'harga', 'min_order', 'max_order', 'status',
            'deskripsi', 'target_hint', 'avg_order_count', 'avg_time_text',
            'rating', 'rating_count', 'refill_label', 'speed_label', 'quality_label', 'start_time'
        ].filter(column => existingColumns.has(column));

        DEFAULT_ORDER_SERVICES.forEach(service => {
            db.query('SELECT id FROM services WHERE LOWER(nama)=LOWER(?) LIMIT 1', [service.nama], (findErr, found) => {
                if (findErr || (found && found.length)) {
                    return;
                }

                const placeholders = allowedColumns.map(() => '?').join(',');
                const values = allowedColumns.map(column => service[column]);
                db.query(
                    `INSERT INTO services (${allowedColumns.join(',')}) VALUES (${placeholders})`,
                    values,
                    insertErr => {
                        if (insertErr) {
                            console.log('Default service seed failed:', service.nama, insertErr.message);
                        }
                    }
                );
            });
        });
    });
}


const uploadDir = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();

        cb(null, uniqueName + ext);
    }
});

const upload = multer({
    storage,

    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp"
        ];

        const allowedExt = [".jpg", ".jpeg", ".png", ".webp"];
        const ext = path.extname(file.originalname).toLowerCase();

        if (!allowedTypes.includes(file.mimetype) || !allowedExt.includes(ext)) {
            return cb(new Error("File harus berupa gambar JPG, PNG, JPEG, atau WEBP"));
        }

        cb(null, true);
    },

    limits: {
        fileSize: 5 * 1024 * 1024
    }
});

function uploadProof(req, res, next) {
    upload.single("proof_image")(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
                return res.render("deposit", {
                    error: "Ukuran bukti transfer maksimal 5MB"
                });
            }

            return res.render("deposit", {
                error: "Gagal upload bukti transfer"
            });
        }

        if (err) {
            return res.render("deposit", {
                error: err.message || "File bukti transfer tidak valid"
            });
        }

        next();
    });
}

function refreshSessionUser(req, res, next) {
    if (!req.session.user || !req.session.user.id) {
        return res.redirect("/");
    }

    db.query(
        "SELECT * FROM users WHERE id=? LIMIT 1",
        [req.session.user.id],
        (err, result) => {
            if (err) {
                console.log("Refresh user error:", err);
                return res.send("Gagal membaca saldo user");
            }

            if (!result || result.length === 0) {
                return req.session.destroy(() => res.redirect("/"));
            }

            const freshUser = result[0];

            if (freshUser.status === "inactive") {
                return req.session.destroy(() => res.redirect("/"));
            }

            req.session.user = freshUser;
            res.locals.user = freshUser;
            next();
        }
    );
}

function auth(req, res, next) {
    return refreshSessionUser(req, res, next);
}

function adminOnly(req, res, next) {
    return refreshSessionUser(req, res, () => {
        if (req.session.user.role !== "admin") {
            return res.send("Akses ditolak");
        }

        next();
    });
}


// =====================
// AUTH
// =====================

app.get("/", (req, res) => {
    if (req.session.user) {
        if (req.session.user.role === "admin") {
            return res.redirect("/admin");
        }

        return res.redirect("/dashboard");
    }

    res.render("login", {
        error: null
    });
});

app.get("/login", (req, res) => {
    if (req.session.user) {
        return req.session.user.role === "admin" ? res.redirect("/admin") : res.redirect("/dashboard");
    }
    res.render("login", { error: null });
});

app.post("/login", (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
        return res.render("login", {
            error: "Email dan password wajib diisi"
        });
    }

    db.query(
        "SELECT * FROM users WHERE LOWER(TRIM(email))=? LIMIT 1",
        [email],
        (err, result) => {
            if (err) {
                console.log("Login error:", err);

                return res.render("login", {
                    error: "Terjadi kesalahan database"
                });
            }

            if (result.length === 0) {
                return res.render("login", {
                    error: "User tidak ditemukan"
                });
            }

            if (result[0].status === "inactive") {
                return res.render("login", {
                    error: "Akun kamu sedang dinonaktifkan. Silakan hubungi admin."
                });
            }

            bcrypt.compare(password, result[0].password, (err, match) => {
                if (err) {
                    console.log("Bcrypt error:", err);

                    return res.render("login", {
                        error: "Login gagal"
                    });
                }

                if (!match) {
                    return res.render("login", {
                        error: "Password salah"
                    });
                }

                req.session.user = result[0];

                if (result[0].role === "admin") {
                    return res.redirect("/admin");
                }

                res.redirect("/dashboard");
            });
        }
    );
});

app.get("/register", (req, res) => {
    if (req.session.user) {
        return res.redirect("/dashboard");
    }

    res.render("register", {
        error: null
    });
});

app.post("/register", (req, res) => {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!username || !email || !password) {
        return res.render("register", {
            error: "Semua field wajib diisi"
        });
    }

    bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
            console.log("Hash error:", err);

            return res.render("register", {
                error: "Gagal membuat akun"
            });
        }

        db.query(
            `
            INSERT INTO users
            (username, email, password, saldo, role, status)
            VALUES(?,?,?,?,?,?)
            `,
            [username, email, hash, 0, "user", "active"],
            (err) => {
                if (err) {
                    console.log("Register error:", err);

                    return res.render("register", {
                        error: "Email sudah digunakan"
                    });
                }

                res.redirect("/");
            }
        );
    });
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});


// =====================
// USER DASHBOARD
// =====================

app.get("/dashboard", auth, (req, res) => {
    db.query(
        "SELECT * FROM users WHERE id=? LIMIT 1",
        [req.session.user.id],
        (err, userResult) => {
            if (err || userResult.length === 0) {
                console.log("Dashboard user error:", err);

                return req.session.destroy(() => {
                    res.redirect("/");
                });
            }

            if (userResult[0].status === "inactive") {
                return req.session.destroy(() => {
                    res.redirect("/");
                });
            }

            req.session.user = userResult[0];

            db.query(
                `SELECT * FROM services WHERE ${ORDER_SERVICE_FILTER_SQL} ORDER BY kategori ASC, nama ASC`,
                (err, services) => {
                    if (err) {
                        console.log("Services error:", err);

                        return res.send("Gagal mengambil layanan");
                    }

                    res.render("dashboard", {
                        user: userResult[0],
                        services,
                        selectedServiceId: null
                    });
                }
            );
        }
    );
});


app.get("/order/single", auth, (req, res) => {
    db.query(
        `SELECT * FROM services WHERE ${ORDER_SERVICE_FILTER_SQL} ORDER BY kategori ASC, nama ASC`,
        (err, services) => {
            if (err) {
                console.log("Order single services error:", err);
                return res.send("Gagal mengambil layanan");
            }

            res.render("dashboard", {
                user: req.session.user,
                services,
                selectedServiceId: req.query.service_id || req.query.service || null
            });
        }
    );
});

app.get("/services", auth, (req, res) => {
    db.query(
        `SELECT * FROM services WHERE ${ORDER_SERVICE_FILTER_SQL} ORDER BY kategori ASC, harga ASC, nama ASC`,
        (err, services) => {
            if (err) {
                console.log("User services list error:", err);
                return res.send("Gagal mengambil layanan");
            }

            res.render("services", {
                services
            });
        }
    );
});

app.get("/account", auth, (req, res) => {
    res.render("simple-page", {
        title: "Pengaturan Akun",
        icon: "⚙",
        message: "Halaman pengaturan akun masih berupa tampilan awal. Data akun dapat dikembangkan tanpa mengubah flow utama.",
        mode: "account"
    });
});

app.get("/tickets", auth, (req, res) => {
    res.render("simple-page", {
        title: "Tiket Bantuan",
        icon: "💬",
        message: "Gunakan halaman ini nanti untuk sistem bantuan, komplain order, refill, dan deposit.",
        mode: "ticket"
    });
});

app.get("/refills", auth, (req, res) => {
    ensureRefillSchema((schemaErr) => {
        if (schemaErr) {
            console.log('Refill schema ready error:', schemaErr);
            return res.render('refills', {
                refills: [],
                eligibleOrders: [],
                pageError: 'Schema refill belum siap. Pastikan MySQL aktif lalu restart server.'
            });
        }

        const eligibleSql = `
            SELECT 
                orders.id,
                orders.target,
                orders.jumlah,
                orders.status,
                services.nama AS service_name,
                services.refill_label
            FROM orders
            JOIN services ON orders.service_id = services.id
            WHERE orders.user_id=?
              AND LOWER(COALESCE(orders.status,'')) IN ('completed','success','sukses')
              AND LOWER(COALESCE(services.refill_label,'')) NOT LIKE '%no refill%'
              AND LOWER(COALESCE(services.refill_label,'')) NOT LIKE '%non refill%'
            ORDER BY orders.id DESC
        `;

        db.query(eligibleSql, [req.session.user.id], (eligibleErr, eligibleOrders) => {
            if (eligibleErr) {
                console.log('Eligible refill orders error:', eligibleErr);
                eligibleOrders = [];
            }

            db.query(
                `
                SELECT 
                    refill_requests.*,
                    orders.status AS order_status,
                    COALESCE(services.nama, CONCAT('Order #', refill_requests.order_id)) AS service_name,
                    COALESCE(services.refill_label, '-') AS refill_label
                FROM refill_requests
                LEFT JOIN orders ON refill_requests.order_id = orders.id
                LEFT JOIN services ON refill_requests.service_id = services.id
                WHERE refill_requests.user_id=?
                ORDER BY refill_requests.id DESC
                `,
                [req.session.user.id],
                (err, refills) => {
                    if (err) {
                        console.log('Refill list error:', err);
                        return res.render('refills', {
                            refills: [],
                            eligibleOrders: eligibleOrders || [],
                            pageError: 'Gagal mengambil riwayat refill. Schema sudah diperbaiki, coba refresh halaman.'
                        });
                    }

                    res.render('refills', {
                        refills: refills || [],
                        eligibleOrders: eligibleOrders || [],
                        pageError: null
                    });
                }
            );
        });
    });
});

app.post("/refills/add", auth, (req, res) => {
    const orderId = Number(req.body.order_id);
    const note = cleanText(req.body.note, 'Mohon proses refill untuk pesanan ini.');

    if (!orderId) {
        return res.send('ID pesanan tidak valid');
    }

    ensureRefillSchema((schemaErr) => {
        if (schemaErr) {
            console.log('Refill schema before insert error:', schemaErr);
            return res.send('Schema refill belum siap. Restart server lalu coba lagi.');
        }

        db.beginTransaction((txErr) => {
            if (txErr) {
                console.log('Refill transaction error:', txErr);
                return res.send('Gagal memulai transaksi refill');
            }

            db.query(
                `
                SELECT 
                    orders.*,
                    services.nama AS service_name,
                    services.refill_label
                FROM orders
                JOIN services ON orders.service_id = services.id
                WHERE orders.id=? AND orders.user_id=?
                FOR UPDATE
                `,
                [orderId, req.session.user.id],
                (err, orderResult) => {
                    if (err || !orderResult.length) {
                        return db.rollback(() => {
                            console.log('Refill order select error:', err);
                            res.send('Pesanan tidak ditemukan');
                        });
                    }

                    const order = orderResult[0];
                    const statusOk = ['completed', 'success', 'sukses'].includes(String(order.status || '').toLowerCase());
                    const refillOk = isRefillEligibleLabel(order.refill_label);

                    if (!statusOk) {
                        return db.rollback(() => res.send('Pesanan belum selesai, belum bisa refill'));
                    }

                    if (!refillOk) {
                        return db.rollback(() => res.send('Layanan ini tidak memiliki garansi refill'));
                    }

                    db.query(
                        `SELECT id FROM refill_requests WHERE user_id=? AND order_id=? AND LOWER(status)='proses' LIMIT 1`,
                        [req.session.user.id, orderId],
                        (dupErr, duplicate) => {
                            if (dupErr) {
                                return db.rollback(() => {
                                    console.log('Refill duplicate check error:', dupErr);
                                    res.send('Gagal mengecek refill aktif');
                                });
                            }

                            if (duplicate && duplicate.length) {
                                return db.rollback(() => res.send('Pesanan ini masih punya refill yang sedang diproses'));
                            }

                            db.query(
                                `
                                INSERT INTO refill_requests
                                (user_id, order_id, service_id, target, status, note)
                                VALUES(?,?,?,?,?,?)
                                `,
                                [req.session.user.id, order.id, order.service_id, order.target, 'Proses', note],
                                (insertErr) => {
                                    if (insertErr) {
                                        return db.rollback(() => {
                                            console.log('Refill insert error:', insertErr);
                                            res.send('Gagal membuat request refill');
                                        });
                                    }

                                    db.commit((commitErr) => {
                                        if (commitErr) {
                                            return db.rollback(() => {
                                                console.log('Refill commit error:', commitErr);
                                                res.send('Gagal menyimpan request refill');
                                            });
                                        }

                                        res.redirect('/refills');
                                    });
                                }
                            );
                        }
                    );
                }
            );
        });
    });
});

app.get("/news", auth, (req, res) => {
    res.render("simple-page", {
        title: "Berita",
        icon: "📰",
        message: "Belum ada berita terbaru. Halaman ini disiapkan untuk update layanan dan informasi panel.",
        mode: "news"
    });
});

app.get("/api/docs", auth, (req, res) => {
    res.render("simple-page", {
        title: "Dokumentasi API",
        icon: "API",
        message: "Dokumentasi API masih berupa cangkang. Integrasi API dapat ditambahkan nanti tanpa mengganggu UI sekarang.",
        mode: "api"
    });
});


// =====================
// USER ORDER
// =====================

app.post("/order", auth, (req, res) => {
    const serviceId = Number(req.body.service_id);
    const target = String(req.body.target || "").trim();
    const qty = Number(req.body.jumlah);

    if (!serviceId || !target || !qty) {
        return res.send("Data order belum lengkap");
    }

    db.query(
        "SELECT * FROM services WHERE id=? AND status='active' LIMIT 1",
        [serviceId],
        (err, serviceResult) => {
            if (err || serviceResult.length === 0) {
                console.log("Service order error:", err);

                return res.send("Layanan tidak ditemukan");
            }

            const service = serviceResult[0];

            if (qty < service.min_order || qty > service.max_order) {
                return res.send(`Jumlah order harus antara ${service.min_order} sampai ${service.max_order}`);
            }

            const total = Math.ceil((service.harga * qty) / 1000);

            db.beginTransaction((err) => {
                if (err) {
                    console.log("Transaction start error:", err);

                    return res.send("Gagal memulai transaksi");
                }

                db.query(
                    "SELECT saldo FROM users WHERE id=? FOR UPDATE",
                    [req.session.user.id],
                    (err, userResult) => {
                        if (err || userResult.length === 0) {
                            return db.rollback(() => {
                                console.log("User saldo error:", err);

                                res.send("User tidak ditemukan");
                            });
                        }

                        if (userResult[0].saldo < total) {
                            return db.rollback(() => {
                                res.send("Saldo tidak cukup");
                            });
                        }

                        const beforeBalance = Number(userResult[0].saldo || 0);
                        const afterBalance = beforeBalance - total;

                        db.query(
                            "UPDATE users SET saldo=? WHERE id=?",
                            [afterBalance, req.session.user.id],
                            (err) => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.log("Saldo update error:", err);

                                        res.send("Gagal memotong saldo");
                                    });
                                }

                                db.query(
                                    `
                                    INSERT INTO orders
                                    (user_id, service_id, target, jumlah, total, status)
                                    VALUES(?,?,?,?,?,?)
                                    `,
                                    [
                                        req.session.user.id,
                                        serviceId,
                                        target,
                                        qty,
                                        total,
                                        "Pending"
                                    ],
                                    (err, orderResult) => {
                                        if (err) {
                                            return db.rollback(() => {
                                                console.log("Insert order error:", err);

                                                res.send("Gagal membuat order");
                                            });
                                        }

                                        db.query(
                                            `
                                            INSERT INTO balance_logs
                                            (user_id, type, amount, before_balance, after_balance, description, reference_type, reference_id)
                                            VALUES(?,?,?,?,?,?,?,?)
                                            `,
                                            [
                                                req.session.user.id,
                                                "ORDER",
                                                -total,
                                                beforeBalance,
                                                afterBalance,
                                                `Pembayaran order layanan ${service.nama}`,
                                                "orders",
                                                orderResult.insertId
                                            ],
                                            (err) => {
                                                if (err) {
                                                    return db.rollback(() => {
                                                        console.log("Insert balance log order error:", err);

                                                        res.send("Gagal mencatat mutasi saldo");
                                                    });
                                                }

                                                db.commit((err) => {
                                                    if (err) {
                                                        return db.rollback(() => {
                                                            console.log("Commit order error:", err);

                                                            res.send("Gagal menyimpan order");
                                                        });
                                                    }

                                                    res.redirect("/orders");
                                                });
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            });
        }
    );
});

app.get("/orders", auth, (req, res) => {
    db.query(
        `
        SELECT 
            orders.*,
            services.nama,
            services.kategori
        FROM orders
        JOIN services ON orders.service_id = services.id
        WHERE orders.user_id=?
        ORDER BY orders.id DESC
        `,
        [req.session.user.id],
        (err, orders) => {
            if (err) {
                console.log("Orders error:", err);

                return res.send("Gagal mengambil riwayat order");
            }

            res.render("orders", {
                orders
            });
        }
    );
});



// =====================
// USER DEPOSIT
// =====================

app.get("/deposit", auth, (req, res) => {
    getActivePaymentMethods((err, paymentMethods) => {
        if (err) {
            console.log('Payment methods fetch error:', err);
        }

        res.render("deposit", {
            error: err ? "Gagal mengambil metode pembayaran" : null,
            paymentMethods: paymentMethods || []
        });
    });
});

app.post("/deposit", auth, uploadProof, (req, res) => {
    const amount = Number(req.body.amount);
    const paymentMethodId = Number(req.body.payment_method_id);

    if (!amount || amount < 10000) {
        return renderDepositWithError(res, req, "Minimal deposit Rp10.000");
    }

    if (!paymentMethodId) {
        return renderDepositWithError(res, req, "Metode pembayaran wajib dipilih");
    }

    if (!req.file) {
        return renderDepositWithError(res, req, "Bukti transfer wajib diupload");
    }

    getActivePaymentMethods((methodErr, paymentMethods) => {
        if (methodErr) {
            console.log('Payment methods validation error:', methodErr);
            return renderDepositWithError(res, req, "Gagal mengambil metode pembayaran");
        }

        const method = (paymentMethods || []).find(item => Number(item.id) === paymentMethodId);
        if (!method) {
            return renderDepositWithError(res, req, "Metode pembayaran tidak aktif atau tidak ditemukan");
        }

        const minAmount = Number(method.min_amount || 10000);
        const maxAmount = Number(method.max_amount || 10000000);

        if (amount < minAmount) {
            return renderDepositWithError(res, req, `Minimal deposit untuk ${method.name} adalah Rp${minAmount.toLocaleString('id-ID')}`);
        }

        if (amount > maxAmount) {
            return renderDepositWithError(res, req, `Maksimal deposit untuk ${method.name} adalah Rp${maxAmount.toLocaleString('id-ID')}`);
        }

        const calc = calculateDepositTotal(amount, method, req.session.user.id);
        const proofImage = "/uploads/" + req.file.filename;

        db.query(
            `
            INSERT INTO deposits
            (user_id, amount, metode, payment_method_id, payment_type, total_pay, fee_amount, unique_code, proof_image, status)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            `,
            [
                req.session.user.id,
                calc.depositAmount,
                method.name,
                method.id,
                method.type,
                calc.totalPay,
                calc.feeAmount,
                calc.uniqueCode,
                proofImage,
                "Pending"
            ],
            (err) => {
                if (err) {
                    console.log("Deposit request error:", err);
                    return renderDepositWithError(res, req, "Gagal membuat request deposit");
                }

                res.redirect("/deposits");
            }
        );
    });
});

app.get("/deposits", auth, (req, res) => {
    ensureManualDepositSchema((schemaErr) => {
        if (schemaErr) {
            console.log('Deposit schema ready error:', schemaErr);
            return res.render("deposits", { deposits: [], pageError: "Schema deposit belum siap. Restart server lalu coba lagi." });
        }

        db.query(
            `
            SELECT *
            FROM deposits
            WHERE user_id=?
            ORDER BY id DESC
            `,
            [req.session.user.id],
            (err, deposits) => {
                if (err) {
                    console.log("Deposit history error:", err);
                    return res.render("deposits", { deposits: [], pageError: "Gagal mengambil riwayat deposit" });
                }

                res.render("deposits", {
                    deposits,
                    pageError: null
                });
            }
        );
    });
});

// =====================
// USER BALANCE LOGS
// =====================

app.get("/balance-logs", auth, (req, res) => {
    db.query(
        `
        SELECT *
        FROM balance_logs
        WHERE user_id=?
        ORDER BY id DESC
        `,
        [req.session.user.id],
        (err, logs) => {
            if (err) {
                console.log("Balance logs error:", err);

                return res.send("Gagal mengambil mutasi saldo");
            }

            res.render("balance-logs", {
                logs
            });
        }
    );
});


// =====================
// ADMIN DASHBOARD
// =====================

app.get("/admin", adminOnly, (req, res) => {
    db.query(
        `
        SELECT 
            COUNT(*) AS total_users,
            COALESCE(SUM(saldo), 0) AS total_saldo_user
        FROM users
        `,
        (err, userStatsResult) => {
            if (err) {
                console.log("Admin user stats error:", err);

                return res.send("Gagal mengambil statistik user");
            }

            db.query(
                `
                SELECT 
                    COUNT(*) AS total_orders,
                    SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) AS pending_orders,
                    SUM(CASE WHEN status='Processing' THEN 1 ELSE 0 END) AS processing_orders,
                    SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) AS completed_orders,
                    SUM(CASE WHEN status='Canceled' THEN 1 ELSE 0 END) AS canceled_orders,
                    COALESCE(SUM(total), 0) AS total_order_value
                FROM orders
                `,
                (err, orderStatsResult) => {
                    if (err) {
                        console.log("Admin order stats error:", err);

                        return res.send("Gagal mengambil statistik order");
                    }

                    db.query(
                        `
                        SELECT 
                            COUNT(*) AS total_deposits,
                            SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) AS pending_deposits,
                            SUM(CASE WHEN status='Approved' THEN 1 ELSE 0 END) AS approved_deposits,
                            SUM(CASE WHEN status='Rejected' THEN 1 ELSE 0 END) AS rejected_deposits,
                            COALESCE(SUM(CASE WHEN status='Approved' THEN amount ELSE 0 END), 0) AS approved_deposit_amount
                        FROM deposits
                        `,
                        (err, depositStatsResult) => {
                            if (err) {
                                console.log("Admin deposit stats error:", err);

                                return res.send("Gagal mengambil statistik deposit");
                            }

                            db.query(
                                `
                                SELECT 
                                    orders.*,
                                    services.nama,
                                    services.kategori,
                                    users.username,
                                    users.email
                                FROM orders
                                JOIN services ON orders.service_id = services.id
                                JOIN users ON orders.user_id = users.id
                                ORDER BY orders.id DESC
                                `,
                                (err, orders) => {
                                    if (err) {
                                        console.log("Admin orders error:", err);

                                        return res.send("Gagal mengambil data order");
                                    }

                                    res.render("admin", {
                                        orders,
                                        stats: {
                                            users: userStatsResult[0],
                                            orders: orderStatsResult[0],
                                            deposits: depositStatsResult[0]
                                        }
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

app.post("/admin/order/update", adminOnly, (req, res) => {
    const id = Number(req.body.id);
    const newStatus = String(req.body.status || "").trim();

    const allowedStatus = ["Pending", "Processing", "Completed", "Canceled"];

    if (!id || !allowedStatus.includes(newStatus)) {
        return res.send("Status order tidak valid");
    }

    db.beginTransaction((err) => {
        if (err) {
            console.log("Order status transaction error:", err);

            return res.send("Gagal memulai transaksi update order");
        }

        db.query(
            `
            SELECT 
                orders.*,
                services.nama AS service_name
            FROM orders
            JOIN services ON orders.service_id = services.id
            WHERE orders.id=?
            FOR UPDATE
            `,
            [id],
            (err, orderResult) => {
                if (err || orderResult.length === 0) {
                    return db.rollback(() => {
                        console.log("Order select error:", err);

                        res.send("Order tidak ditemukan");
                    });
                }

                const order = orderResult[0];
                const oldStatus = order.status;

                if (oldStatus === newStatus) {
                    return db.rollback(() => {
                        res.redirect("/admin");
                    });
                }

                const shouldRefund =
                    newStatus === "Canceled" &&
                    order.refunded_at === null &&
                    oldStatus !== "Canceled";

                if (!shouldRefund) {
                    db.query(
                        "UPDATE orders SET status=? WHERE id=?",
                        [newStatus, id],
                        (err) => {
                            if (err) {
                                return db.rollback(() => {
                                    console.log("Update order status error:", err);

                                    res.send("Gagal update status order");
                                });
                            }

                            db.commit((err) => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.log("Commit order status error:", err);

                                        res.send("Gagal menyimpan status order");
                                    });
                                }

                                res.redirect("/admin");
                            });
                        }
                    );

                    return;
                }

                db.query(
                    "SELECT saldo FROM users WHERE id=? FOR UPDATE",
                    [order.user_id],
                    (err, userResult) => {
                        if (err || userResult.length === 0) {
                            return db.rollback(() => {
                                console.log("Refund user select error:", err);

                                res.send("User order tidak ditemukan");
                            });
                        }

                        const beforeBalance = Number(userResult[0].saldo || 0);
                        const afterBalance = beforeBalance + order.total;

                        db.query(
                            "UPDATE users SET saldo=? WHERE id=?",
                            [afterBalance, order.user_id],
                            (err) => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.log("Refund balance error:", err);

                                        res.send("Gagal refund saldo user");
                                    });
                                }

                                db.query(
                                    `
                                    INSERT INTO balance_logs
                                    (user_id, type, amount, before_balance, after_balance, description, reference_type, reference_id)
                                    VALUES(?,?,?,?,?,?,?,?)
                                    `,
                                    [
                                        order.user_id,
                                        "REFUND",
                                        order.total,
                                        beforeBalance,
                                        afterBalance,
                                        `Refund order dibatalkan: ${order.service_name}`,
                                        "orders",
                                        order.id
                                    ],
                                    (err) => {
                                        if (err) {
                                            return db.rollback(() => {
                                                console.log("Refund balance log error:", err);

                                                res.send("Gagal mencatat mutasi refund");
                                            });
                                        }

                                        db.query(
                                            "UPDATE orders SET status='Canceled', refunded_at=NOW() WHERE id=?",
                                            [id],
                                            (err) => {
                                                if (err) {
                                                    return db.rollback(() => {
                                                        console.log("Cancel order update error:", err);

                                                        res.send("Gagal membatalkan order");
                                                    });
                                                }

                                                db.commit((err) => {
                                                    if (err) {
                                                        return db.rollback(() => {
                                                            console.log("Refund commit error:", err);

                                                            res.send("Gagal menyimpan refund");
                                                        });
                                                    }

                                                    res.redirect("/admin");
                                                });
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});


// =====================
// ADMIN USERS
// =====================



app.get("/admin/sales-report", adminOnly, (req, res) => {
    const statusMode = String(req.query.status || 'valid').trim();
    const rawDateFrom = String(req.query.from || '').trim();
    const rawDateTo = String(req.query.to || '').trim();

    const filters = [];
    const params = [];

    if (statusMode === 'completed') {
        filters.push("LOWER(COALESCE(orders.status,'')) IN ('completed','success','sukses')");
    } else if (statusMode === 'all') {
        filters.push('1=1');
    } else {
        filters.push("LOWER(COALESCE(orders.status,'')) NOT IN ('canceled','cancelled','failed','error','rejected')");
    }

    if (rawDateFrom) {
        filters.push('DATE(orders.created_at) >= ?');
        params.push(rawDateFrom);
    }
    if (rawDateTo) {
        filters.push('DATE(orders.created_at) <= ?');
        params.push(rawDateTo);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    db.query(
        `
        SELECT
            orders.id,
            orders.user_id,
            orders.service_id,
            orders.target,
            orders.jumlah,
            orders.total,
            orders.status,
            orders.created_at,
            services.nama,
            services.kategori,
            users.username,
            users.email
        FROM orders
        LEFT JOIN services ON orders.service_id = services.id
        LEFT JOIN users ON orders.user_id = users.id
        ${whereClause}
        ORDER BY orders.created_at ASC, orders.id ASC
        `,
        params,
        (err, rows) => {
            if (err) {
                console.log('Sales report error:', err);
                return res.send('Gagal mengambil laporan sales');
            }

            const salesRows = rows || [];
            const totalRevenue = salesRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
            const totalOrders = salesRows.length;
            const totalQty = salesRows.reduce((sum, row) => sum + Number(row.jumlah || 0), 0);
            const avgOrderValue = totalOrders ? Math.round(totalRevenue / totalOrders) : 0;

            const reportData = {
                yearly: buildSalesSeries(salesRows, 'yearly'),
                monthly: buildSalesSeries(salesRows, 'monthly'),
                weekly: buildSalesSeries(salesRows, 'weekly'),
                daily: buildSalesSeries(salesRows, 'daily'),
                topServices: topSalesServices(salesRows, 8),
                latestOrders: salesRows.slice().sort((a, b) => Number(b.id || 0) - Number(a.id || 0)).slice(0, 12)
            };

            res.render('sales-report', {
                stats: {
                    totalRevenue,
                    totalOrders,
                    totalQty,
                    avgOrderValue,
                    statusMode,
                    dateFrom: rawDateFrom,
                    dateTo: rawDateTo
                },
                reportData
            });
        }
    );
});

app.get("/admin/users", adminOnly, (req, res) => {
    db.query(
        `
        SELECT 
            id,
            username,
            email,
            saldo,
            role,
            COALESCE(status, 'active') AS status
        FROM users
        ORDER BY id DESC
        `,
        (err, users) => {
            if (err) {
                console.log("Admin users error:", err);

                return res.send("Gagal mengambil data user");
            }

            res.render("admin-users", {
                users
            });
        }
    );
});

app.post("/admin/users/update", adminOnly, (req, res) => {
    const id = Number(req.body.id);
    const role = String(req.body.role || "").trim();
    const status = String(req.body.status || "").trim();

    if (!id) {
        return res.send("User tidak valid");
    }

    if (!["user", "admin"].includes(role)) {
        return res.send("Role tidak valid");
    }

    if (!["active", "inactive"].includes(status)) {
        return res.send("Status user tidak valid");
    }

    if (id === req.session.user.id && status === "inactive") {
        return res.send("Kamu tidak bisa menonaktifkan akun sendiri");
    }

    if (id === req.session.user.id && role !== "admin") {
        return res.send("Kamu tidak bisa menghapus role admin dari akun sendiri");
    }

    db.query(
        `
        UPDATE users
        SET role=?, status=?
        WHERE id=?
        `,
        [role, status, id],
        (err) => {
            if (err) {
                console.log("Update user error:", err);

                return res.send("Gagal update user");
            }

            res.redirect("/admin/users");
        }
    );
});

app.post("/admin/users/balance", adminOnly, (req, res) => {
    const id = Number(req.body.id);
    const action = String(req.body.action || "add").trim();
    const amount = Number(req.body.amount);
    const note = String(req.body.note || "").trim();

    if (!id) {
        return res.send("User tidak valid");
    }

    // DK PANEL policy: admin only boleh MENAMBAH saldo user.
    // Pengurangan saldo manual diblokir dari backend walaupun request dikirim lewat DevTools/Postman.
    if (action !== "add") {
        return res.status(403).send("Aksi pengurangan saldo tidak diizinkan. Admin hanya boleh menambah saldo user.");
    }

    if (!amount || amount <= 0) {
        return res.send("Nominal harus lebih dari 0");
    }

    db.beginTransaction((err) => {
        if (err) {
            console.log("Manual balance transaction error:", err);

            return res.send("Gagal memulai transaksi saldo");
        }

        db.query(
            "SELECT saldo FROM users WHERE id=? FOR UPDATE",
            [id],
            (err, userResult) => {
                if (err || userResult.length === 0) {
                    return db.rollback(() => {
                        console.log("Manual balance user error:", err);

                        res.send("User tidak ditemukan");
                    });
                }

                const beforeBalance = Number(userResult[0].saldo || 0);
                const signedAmount = amount;
                const afterBalance = beforeBalance + signedAmount;

                db.query(
                    "UPDATE users SET saldo=? WHERE id=?",
                    [afterBalance, id],
                    (err) => {
                        if (err) {
                            return db.rollback(() => {
                                console.log("Manual balance update error:", err);

                                res.send("Gagal update saldo user");
                            });
                        }

                        db.query(
                            `
                            INSERT INTO balance_logs
                            (user_id, type, amount, before_balance, after_balance, description, reference_type, reference_id)
                            VALUES(?,?,?,?,?,?,?,?)
                            `,
                            [
                                id,
                                "MANUAL_ADD",
                                signedAmount,
                                beforeBalance,
                                afterBalance,
                                note || "Saldo ditambah manual oleh admin",
                                "users",
                                id
                            ],
                            (err) => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.log("Manual balance log error:", err);

                                        res.send("Gagal mencatat mutasi saldo");
                                    });
                                }

                                db.commit((err) => {
                                    if (err) {
                                        return db.rollback(() => {
                                            console.log("Manual balance commit error:", err);

                                            res.send("Gagal menyimpan transaksi saldo");
                                        });
                                    }

                                    res.redirect("/admin/users");
                                });
                            }
                        );
                    }
                );
            }
        );
    });
});


// =====================
// ADMIN SERVICES
// =====================

app.get("/admin/services", adminOnly, (req, res) => {
    db.query(
        "SELECT * FROM services ORDER BY id DESC",
        (err, services) => {
            if (err) {
                console.log("Admin services error:", err);

                return res.send("Gagal mengambil layanan");
            }

            res.render("admin-services", {
                services
            });
        }
    );
});

app.post("/admin/services/add", adminOnly, (req, res) => {
    const nama = cleanText(req.body.nama);
    const kategori = cleanText(req.body.kategori);
    const harga = cleanNumber(req.body.harga);
    const minOrder = cleanNumber(req.body.min_order);
    const maxOrder = cleanNumber(req.body.max_order);
    const status = cleanText(req.body.status, "active");
    const deskripsi = cleanText(req.body.deskripsi);
    const targetHint = cleanText(req.body.target_hint);
    const avgOrderCount = cleanNumber(req.body.avg_order_count);
    const avgTimeText = cleanText(req.body.avg_time_text);
    const rating = Math.max(0, Math.min(5, cleanNumber(req.body.rating, 5)));
    const ratingCount = cleanNumber(req.body.rating_count);
    const refillLabel = cleanText(req.body.refill_label, "No Refill");
    const speedLabel = cleanText(req.body.speed_label);
    const qualityLabel = cleanText(req.body.quality_label);
    const startTime = cleanText(req.body.start_time);

    if (!nama || !kategori || !harga || !minOrder || !maxOrder) {
        return res.send("Data layanan belum lengkap");
    }

    if (harga <= 0 || minOrder <= 0 || maxOrder <= 0) {
        return res.send("Harga, minimal order, dan maksimal order harus lebih dari 0");
    }

    if (minOrder > maxOrder) {
        return res.send("Minimal order tidak boleh lebih besar dari maksimal order");
    }

    if (!['active', 'inactive'].includes(status)) {
        return res.send("Status layanan tidak valid");
    }

    db.query(
        `
        INSERT INTO services
        (nama, kategori, harga, min_order, max_order, status, deskripsi, target_hint, avg_order_count, avg_time_text, rating, rating_count, refill_label, speed_label, quality_label, start_time)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `,
        [nama, kategori, harga, minOrder, maxOrder, status, deskripsi, targetHint, avgOrderCount, avgTimeText, rating, ratingCount, refillLabel, speedLabel, qualityLabel, startTime],
        (err) => {
            if (err) {
                console.log("Add service error:", err);
                return res.send("Gagal menambah layanan. Pastikan tabel services sudah memiliki kolom metadata layanan.");
            }

            res.redirect("/admin/services");
        }
    );
});

app.post("/admin/services/update", adminOnly, (req, res) => {
    const id = cleanNumber(req.body.id);
    const nama = cleanText(req.body.nama);
    const kategori = cleanText(req.body.kategori);
    const harga = cleanNumber(req.body.harga);
    const minOrder = cleanNumber(req.body.min_order);
    const maxOrder = cleanNumber(req.body.max_order);
    const status = cleanText(req.body.status, "active");
    const deskripsi = cleanText(req.body.deskripsi);
    const targetHint = cleanText(req.body.target_hint);
    const avgOrderCount = cleanNumber(req.body.avg_order_count);
    const avgTimeText = cleanText(req.body.avg_time_text);
    const rating = Math.max(0, Math.min(5, cleanNumber(req.body.rating, 5)));
    const ratingCount = cleanNumber(req.body.rating_count);
    const refillLabel = cleanText(req.body.refill_label, "No Refill");
    const speedLabel = cleanText(req.body.speed_label);
    const qualityLabel = cleanText(req.body.quality_label);
    const startTime = cleanText(req.body.start_time);

    if (!id) {
        return res.send("Layanan tidak valid");
    }

    if (!nama || !kategori || !harga || !minOrder || !maxOrder) {
        return res.send("Data layanan belum lengkap");
    }

    if (harga <= 0 || minOrder <= 0 || maxOrder <= 0) {
        return res.send("Harga, minimal order, dan maksimal order harus lebih dari 0");
    }

    if (minOrder > maxOrder) {
        return res.send("Minimal order tidak boleh lebih besar dari maksimal order");
    }

    if (!['active', 'inactive'].includes(status)) {
        return res.send("Status layanan tidak valid");
    }

    db.query(
        `
        UPDATE services
        SET nama=?, kategori=?, harga=?, min_order=?, max_order=?, status=?, deskripsi=?, target_hint=?, avg_order_count=?, avg_time_text=?, rating=?, rating_count=?, refill_label=?, speed_label=?, quality_label=?, start_time=?
        WHERE id=?
        `,
        [nama, kategori, harga, minOrder, maxOrder, status, deskripsi, targetHint, avgOrderCount, avgTimeText, rating, ratingCount, refillLabel, speedLabel, qualityLabel, startTime, id],
        (err) => {
            if (err) {
                console.log("Update service error:", err);
                return res.send("Gagal update layanan. Pastikan tabel services sudah memiliki kolom metadata layanan.");
            }

            res.redirect("/admin/services");
        }
    );
});

app.post("/admin/services/delete", adminOnly, (req, res) => {
    const id = Number(req.body.id);

    if (!id) {
        return res.send("Layanan tidak valid");
    }

    db.query(
        "UPDATE services SET status='inactive' WHERE id=?",
        [id],
        (err) => {
            if (err) {
                console.log("Delete service error:", err);

                return res.send("Gagal menonaktifkan layanan");
            }

            res.redirect("/admin/services");
        }
    );
});


app.post("/admin/services/hard-delete", adminOnly, (req, res) => {
    const id = Number(req.body.id);

    if (!id) {
        return res.send("Layanan tidak valid");
    }

    db.query(
        "SELECT COUNT(*) AS total FROM orders WHERE service_id=?",
        [id],
        (countErr, rows) => {
            if (countErr) {
                console.log("Check service order usage error:", countErr);
                return res.send("Gagal mengecek penggunaan layanan");
            }

            const usedCount = Number(rows && rows[0] ? rows[0].total : 0);
            if (usedCount > 0) {
                return res.send("Layanan sudah memiliki riwayat order, jadi tidak bisa dihapus permanen. Nonaktifkan layanan agar riwayat sales tetap aman.");
            }

            db.query(
                "DELETE FROM services WHERE id=? LIMIT 1",
                [id],
                (err) => {
                    if (err) {
                        console.log("Hard delete service error:", err);
                        return res.send("Gagal menghapus layanan");
                    }

                    res.redirect("/admin/services");
                }
            );
        }
    );
});



// =====================
// ADMIN DEPOSITS
// =====================

app.get("/admin/deposits", adminOnly, (req, res) => {
    ensureManualDepositSchema((schemaErr) => {
        if (schemaErr) {
            console.log('Admin deposit schema ready error:', schemaErr);
            return res.render("admin-deposits", { deposits: [], stats: {}, pageError: "Schema deposit belum siap. Restart server lalu coba lagi." });
        }

        db.query(
            `
            SELECT 
                deposits.*,
                users.username,
                users.email
            FROM deposits
            JOIN users ON deposits.user_id = users.id
            ORDER BY deposits.id DESC
            `,
            (err, deposits) => {
                if (err) {
                    console.log("Admin deposits error:", err);
                    return res.render("admin-deposits", { deposits: [], stats: {}, pageError: "Gagal mengambil data deposit" });
                }

                const list = deposits || [];
                const stats = {
                    total: list.length,
                    pending: list.filter(d => String(d.status || '').toLowerCase() === 'pending').length,
                    approved: list.filter(d => ['approved', 'sukses', 'success'].includes(String(d.status || '').toLowerCase())).length,
                    rejected: list.filter(d => ['rejected', 'ditolak'].includes(String(d.status || '').toLowerCase())).length,
                    pendingAmount: list.filter(d => String(d.status || '').toLowerCase() === 'pending').reduce((sum, d) => sum + Number(d.amount || 0), 0),
                    approvedAmount: list.filter(d => ['approved', 'sukses', 'success'].includes(String(d.status || '').toLowerCase())).reduce((sum, d) => sum + Number(d.amount || 0), 0)
                };

                res.render("admin-deposits", {
                    deposits: list,
                    stats,
                    pageError: null
                });
            }
        );
    });
});

app.post("/admin/deposit/update", adminOnly, (req, res) => {
    const id = Number(req.body.id);
    const status = String(req.body.status || "").trim();
    const adminNote = String(req.body.admin_note || "").trim();

    if (!id || !["Approved", "Rejected"].includes(status)) {
        return res.send("Status deposit tidak valid");
    }

    ensureManualDepositSchema((schemaErr) => {
        if (schemaErr) {
            console.log('Deposit update schema error:', schemaErr);
            return res.send('Schema deposit belum siap');
        }

        db.beginTransaction((err) => {
            if (err) {
                console.log("Deposit transaction start error:", err);
                return res.send("Gagal memulai transaksi deposit");
            }

            db.query(
                "SELECT * FROM deposits WHERE id=? AND status='Pending' FOR UPDATE",
                [id],
                (err, result) => {
                    if (err || result.length === 0) {
                        return db.rollback(() => {
                            console.log("Deposit select error:", err);
                            res.send("Deposit tidak ditemukan atau sudah diproses");
                        });
                    }

                    const deposit = result[0];

                    if (status === "Rejected") {
                        db.query(
                            "UPDATE deposits SET status='Rejected', admin_note=?, processed_at=NOW() WHERE id=?",
                            [adminNote || 'Ditolak admin', id],
                            (err) => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.log("Reject deposit error:", err);
                                        res.send("Gagal menolak deposit");
                                    });
                                }

                                db.commit((err) => {
                                    if (err) {
                                        return db.rollback(() => {
                                            console.log("Reject commit error:", err);
                                            res.send("Gagal menyimpan status deposit");
                                        });
                                    }

                                    res.redirect("/admin/deposits");
                                });
                            }
                        );

                        return;
                    }

                    db.query(
                        "SELECT saldo FROM users WHERE id=? FOR UPDATE",
                        [deposit.user_id],
                        (err, userResult) => {
                            if (err || userResult.length === 0) {
                                return db.rollback(() => {
                                    console.log("Approve user balance select error:", err);
                                    res.send("User deposit tidak ditemukan");
                                });
                            }

                            const beforeBalance = Number(userResult[0].saldo || 0);
                            const depositAmount = Number(deposit.amount || 0);
                            const afterBalance = beforeBalance + depositAmount;

                            db.query(
                                "UPDATE users SET saldo=? WHERE id=?",
                                [afterBalance, deposit.user_id],
                                (err) => {
                                    if (err) {
                                        return db.rollback(() => {
                                            console.log("Approve balance error:", err);
                                            res.send("Gagal menambah saldo");
                                        });
                                    }

                                    db.query(
                                        `
                                        INSERT INTO balance_logs
                                        (user_id, type, amount, before_balance, after_balance, description, reference_type, reference_id)
                                        VALUES(?,?,?,?,?,?,?,?)
                                        `,
                                        [
                                            deposit.user_id,
                                            "DEPOSIT",
                                            depositAmount,
                                            beforeBalance,
                                            afterBalance,
                                            `Deposit manual disetujui admin via ${deposit.metode || 'metode pembayaran'}`,
                                            "deposits",
                                            deposit.id
                                        ],
                                        (err) => {
                                            if (err) {
                                                return db.rollback(() => {
                                                    console.log("Insert balance log deposit error:", err);
                                                    res.send("Gagal mencatat mutasi deposit");
                                                });
                                            }

                                            db.query(
                                                "UPDATE deposits SET status='Approved', admin_note=?, processed_at=NOW() WHERE id=?",
                                                [adminNote || 'Deposit disetujui admin', id],
                                                (err) => {
                                                    if (err) {
                                                        return db.rollback(() => {
                                                            console.log("Approve deposit error:", err);
                                                            res.send("Gagal update status deposit");
                                                        });
                                                    }

                                                    db.commit((err) => {
                                                        if (err) {
                                                            return db.rollback(() => {
                                                                console.log("Approve commit error:", err);
                                                                res.send("Gagal menyimpan deposit");
                                                            });
                                                        }

                                                        res.redirect("/admin/deposits");
                                                    });
                                                }
                                            );
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        });
    });
});

// =====================
// ADMIN BALANCE LOGS
// =====================

app.get("/admin/balance-logs", adminOnly, (req, res) => {
    db.query(
        `
        SELECT 
            balance_logs.*,
            users.username,
            users.email
        FROM balance_logs
        JOIN users ON balance_logs.user_id = users.id
        ORDER BY balance_logs.id DESC
        `,
        (err, logs) => {
            if (err) {
                console.log("Admin balance logs error:", err);

                return res.send("Gagal mengambil mutasi saldo admin");
            }

            res.render("admin-balance-logs", {
                logs
            });
        }
    );
});


// =====================
// SERVER
// =====================



app.get("/admin/refills", adminOnly, (req, res) => {
    ensureRefillSchema((schemaErr) => {
        if (schemaErr) {
            console.log('Admin refill schema ready error:', schemaErr);
            return res.render('admin-refills', { refills: [], pageError: 'Schema refill belum siap. Restart server lalu coba lagi.' });
        }

        db.query(
            `
            SELECT 
                refill_requests.*,
                users.username,
                users.email,
                COALESCE(services.nama, CONCAT('Order #', refill_requests.order_id)) AS service_name,
                COALESCE(services.refill_label, '-') AS refill_label,
                orders.status AS order_status
            FROM refill_requests
            LEFT JOIN users ON refill_requests.user_id = users.id
            LEFT JOIN services ON refill_requests.service_id = services.id
            LEFT JOIN orders ON refill_requests.order_id = orders.id
            ORDER BY refill_requests.id DESC
            `,
            (err, refills) => {
                if (err) {
                    console.log('Admin refill list error:', err);
                    return res.render('admin-refills', { refills: [], pageError: 'Gagal mengambil data refill. Schema sudah diperbaiki, coba refresh halaman.' });
                }

                res.render('admin-refills', { refills: refills || [], pageError: null });
            }
        );
    });
});

app.post("/admin/refills/update", adminOnly, (req, res) => {
    const id = Number(req.body.id);
    const status = normalizeRefillStatus(req.body.status);
    const adminNote = cleanText(req.body.admin_note, '');

    if (!id) {
        return res.send('ID refill tidak valid');
    }

    db.query(
        `UPDATE refill_requests SET status=?, admin_note=?, updated_at=NOW() WHERE id=?`,
        [status, adminNote, id],
        (err) => {
            if (err) {
                console.log('Admin refill update error:', err);
                return res.send('Gagal update refill');
            }

            res.redirect('/admin/refills');
        }
    );
});

app.listen(3000, () => {
    console.log(`${APP_NAME} jalan di port 3000`);
});