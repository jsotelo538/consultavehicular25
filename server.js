require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const path = require("path");
const { MercadoPagoConfig, Preference } = require("mercadopago");

const app = express();

// Conexión MySQL
const db = mysql.createPool({
  host: "38.242.248.121",
  user: "root",
  password: "1234",
  database: "consultavehicular"
});

// Sesiones
app.use(session({
  secret: "clave-super-secreta",
  resave: false,
  saveUninitialized: true
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

// MercadoPago
const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.ACCESS_TOKEN,
});

// ----------- AUTENTICACIÓN -----------
function adminRequired(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).send("Acceso denegado");
  }
  next();
}
// Registro
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  try {
    // Verificar si ya existe el correo
    const [rows] = await db.execute("SELECT * FROM users WHERE email=?", [email]);
    if (rows.length > 0) {
      return res.json({ success: false, message: "El correo ya está registrado" });
    }

    await db.execute(
      "INSERT INTO users (name, email, password) VALUES (?,?,?)",
      [name, email, hashed]
    );

        res.json({ success: true, message: "Registro exitoso. Redirigiendo...", redirect: "/login.html" });
  } catch (err) {
    console.error("Error en registro:", err);
    res.status(500).json({ success: false, message: "Error en el servidor" });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await db.execute("SELECT * FROM users WHERE email=?", [email]);

    if (rows.length === 0) {
      return res.json({ success: false, message: "Correo o contraseña incorrectos" });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.json({ success: false, message: "Correo o contraseña incorrectos" });
    }

    // ✅ login correcto
    req.session.userId = user.id;
    
    req.session.hasPaid = user.has_paid;
    req.session.role = user.role;
   // Redirigir según rol
    if (user.role === "admin") {
      return res.json({ success: true, redirect: "/admin.html" });
    } else {
      return res.json({ success: true, redirect: "/pago.html" });
    }

  } catch (err) {
    console.error("Error en login:", err);
    res.status(500).json({ success: false, message: "Error en el servidor" });
  }
});
// Middleware de autenticación
function loginRequired(req, res, next) {
  if (!req.session.userId) return res.redirect("/login.html");
  next();
}

function pagoRequired(req, res, next) {
  if (!req.session.hasPaid) return res.redirect("/pago.html");
  next();
}

app.post("/crear-preferencia", async (req, res) => {
  try {
    const { plan, monto } = req.body;

    const preference = await new Preference(mercadopago).create({
      body: {
        items: [
          {
            title: `Consulta Vehicular - ${plan}`,
            quantity: 1,
            unit_price: Number(monto),
            currency_id: "PEN"
          }
        ],
        back_urls: {
          success: "https://www.consultavehicular.services/result.html",
          failure: "https://www.consultavehicular.services/pago-fallido",
        },
        auto_return: "approved",
      }
    });

    res.json({ id: preference.id });
  } catch (error) {
    console.error("Error al crear preferencia:", error);
    res.status(500).json({ error: "No se pudo crear la preferencia" });
  }
});
// Webhook MercadoPago (marca como pagado en BD)
app.post("/webhook", async (req, res) => {
  try {
    const payment = req.body;

    if (payment.type === "payment" && payment.data.status === "approved") {
      const userId = req.session.userId;
      if (userId) {
        await db.execute("UPDATE users SET has_paid=1 WHERE id=?", [userId]);
        req.session.hasPaid = true;
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Error en webhook:", err);
    res.sendStatus(500);
  }
});
// Usuario pide recuperar contraseña
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  // Verificar si el usuario existe
  const [rows] = await db.execute("SELECT * FROM users WHERE email=?", [email]);
  if (rows.length === 0) {
    return res.json({ success: false, message: "Correo no encontrado" });
  }

  const token = crypto.randomBytes(20).toString("hex");
  const expires = new Date(Date.now() + 3600000); // 1 hora

  await db.execute("UPDATE users SET reset_token=?, reset_expires=? WHERE email=?",
    [token, expires, email]);

  // Configurar envío de email
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

  const resetUrl = `https://www.consultavehicular.services/reset-password.html?token=${token}`;
  
 await transporter.sendMail({
  from: `"Soporte Consultas" <${process.env.EMAIL_USER}>`,
  to: email,
  subject: "Recupera tu contraseña",
  html: `<p>Haz clic en el enlace para resetear tu contraseña:</p>
         <a href="${resetUrl}">${resetUrl}</a>`
});

  res.json({ success: true, message: "Se envió un correo con instrucciones" });
});
app.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  const [rows] = await db.execute(
    "SELECT * FROM users WHERE reset_token=? AND reset_expires > NOW()", 
    [token]
  );

  if (rows.length === 0) {
    return res.json({ success: false, message: "Token inválido o expirado" });
  }

  const hashed = await bcrypt.hash(newPassword, 10);

  await db.execute(
    "UPDATE users SET password=?, reset_token=NULL, reset_expires=NULL WHERE id=?",
    [hashed, rows[0].id]
  );

  res.json({ success: true, message: "Contraseña actualizada con éxito" });
});

// ----------- RUTAS PROTEGIDAS -----------
// Ruta para obtener todos los usuarios (solo admins)
app.get("/admin/users", async (req, res) => {
  if (req.session.role !== "admin") {
    return res.status(403).json({ success: false, message: "Acceso denegado" });
  }

  try {
    const [users] = await db.execute("SELECT id, name, email, has_paid FROM users");
    res.json({ success: true, users });
  } catch (err) {
    console.error("Error al obtener usuarios:", err);
    res.status(500).json({ success: false, message: "Error en el servidor" });
  }
});

app.get("/estado-usuario", (req, res) => {
  res.json({
    loggedIn: !!req.session.userId,
    hasPaid: req.session.hasPaid || false
  });
});
// Página de resultado protegida
app.get("/result", loginRequired, pagoRequired, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "result.html"));
});

app.listen(3000, () => console.log("Servidor en http://localhost:3000"));