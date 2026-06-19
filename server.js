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

db.connect((err) => {
    if (err) {
        console.log("Database error:", err);
    } else {
        console.log("Database Connected");
        ensureServiceMetadataColumns();
    }
});

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
                "SELECT * FROM services WHERE status='active' ORDER BY kategori ASC, nama ASC",
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
        "SELECT * FROM services WHERE status='active' ORDER BY kategori ASC, nama ASC",
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
        "SELECT * FROM services WHERE status='active' ORDER BY kategori ASC, harga ASC, nama ASC",
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
    res.render("simple-page", {
        title: "Refill",
        icon: "♻",
        message: "Halaman refill disiapkan untuk layanan bergaransi. Backend refill bisa ditambahkan setelah flow order stabil.",
        mode: "refill"
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
    res.render("deposit", {
        error: null
    });
});

app.post("/deposit", auth, uploadProof, (req, res) => {
    const amount = Number(req.body.amount);
    const metode = String(req.body.metode || "").trim();

    if (!amount || amount < 10000) {
        return res.render("deposit", {
            error: "Minimal deposit Rp10.000"
        });
    }

    if (!metode) {
        return res.render("deposit", {
            error: "Metode pembayaran wajib dipilih"
        });
    }

    if (!req.file) {
        return res.render("deposit", {
            error: "Bukti transfer wajib diupload"
        });
    }

    const proofImage = "/uploads/" + req.file.filename;

    db.query(
        `
        INSERT INTO deposits
        (user_id, amount, metode, proof_image, status)
        VALUES(?,?,?,?,?)
        `,
        [
            req.session.user.id,
            amount,
            metode,
            proofImage,
            "Pending"
        ],
        (err) => {
            if (err) {
                console.log("Deposit request error:", err);

                return res.render("deposit", {
                    error: "Gagal membuat request deposit"
                });
            }

            res.redirect("/deposits");
        }
    );
});

app.get("/deposits", auth, (req, res) => {
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

                return res.send("Gagal mengambil riwayat deposit");
            }

            res.render("deposits", {
                deposits
            });
        }
    );
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
    const action = String(req.body.action || "").trim();
    const amount = Number(req.body.amount);
    const note = String(req.body.note || "").trim();

    if (!id) {
        return res.send("User tidak valid");
    }

    if (!["add", "subtract"].includes(action)) {
        return res.send("Aksi saldo tidak valid");
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
                const signedAmount = action === "add" ? amount : -amount;
                const afterBalance = beforeBalance + signedAmount;

                if (afterBalance < 0) {
                    return db.rollback(() => {
                        res.send("Saldo user tidak boleh minus");
                    });
                }

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
                                action === "add" ? "MANUAL_ADD" : "MANUAL_SUBTRACT",
                                signedAmount,
                                beforeBalance,
                                afterBalance,
                                note || (
                                    action === "add"
                                        ? "Saldo ditambah manual oleh admin"
                                        : "Saldo dikurangi manual oleh admin"
                                ),
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


// =====================
// ADMIN DEPOSITS
// =====================

app.get("/admin/deposits", adminOnly, (req, res) => {
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

                return res.send("Gagal mengambil data deposit");
            }

            res.render("admin-deposits", {
                deposits
            });
        }
    );
});

app.post("/admin/deposit/update", adminOnly, (req, res) => {
    const id = Number(req.body.id);
    const status = String(req.body.status || "").trim();

    if (!id || !["Approved", "Rejected"].includes(status)) {
        return res.send("Status deposit tidak valid");
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
                        "UPDATE deposits SET status='Rejected', processed_at=NOW() WHERE id=?",
                        [id],
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
                        const afterBalance = beforeBalance + deposit.amount;

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
                                        deposit.amount,
                                        beforeBalance,
                                        afterBalance,
                                        "Deposit disetujui admin",
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
                                            "UPDATE deposits SET status='Approved', processed_at=NOW() WHERE id=?",
                                            [id],
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

app.listen(3000, () => {
    console.log(`${APP_NAME} jalan di port 3000`);
});