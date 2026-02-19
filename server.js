require("dotenv").config();
const express = require("express");
const app = express(); 
const fs = require('fs'); 
const puppeteer = require("puppeteer");
const axios = require("axios");
 
const FormData = require("form-data");
 const cors = require("cors");
app.use(cors());
const bodyParser = require("body-parser");
  const API_KEY = 'd6fb31ad4bee4d576b69ceacc98c0b25';
 const API_KEY_2CAPTCHA = 'd6fb31ad4bee4d576b69ceacc98c0b25'; 
app.use(bodyParser.json());
 app.use(express.static("public"));
 app.use(express.urlencoded({ extended: false }));
 app.use(express.json());
 
 const { MercadoPagoConfig, Preference } = require("mercadopago");
 
  const mercadopago = new MercadoPagoConfig({
    accessToken: process.env.ACCESS_TOKEN,
  });
  
  app.use(bodyParser.json());
  app.use(express.static("public"));
  
  app.post("/crear-preferencia", async (req, res) => {
    try {
      const preference = await new Preference(mercadopago).create({
        body: {
          items: [
            {
              title: "Consulta vehicular",
              quantity: 1,
              unit_price:10,
              currency_id: "PEN",
            },
          ],
          back_urls: {
            success: "https://www.informacionvehicular.online/resu.html",
            failure: "https://www.informacionvehicular.online",
            pending: "https://www.informacionvehicular.online/pendiente",
          },
          auto_return: "approved",
        },
      });
  
      res.json({ id: preference.id });
    } catch (error) {
      console.error("Error al crear preferencia:", error);
      res.status(500).json({ error: "No se pudo crear la preferencia" });
    }
  });
  

// --------- RESOLVER TURNSTILE ---------
async function resolverTurnstile(page) {
  console.log("⏳ Esperando a que cargue Cloudflare Turnstile...");

  // Aseguramos que el widget existe
  await page.waitForSelector(".cf-turnstile", { visible: true, timeout: 60000 });
  console.log("✅ Widget encontrado");

  // Ahora simplemente esperamos a que el token aparezca
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('input[name="cf-turnstile-response"]');
      return el && el.value.length > 0;
    }, { timeout: 45000 });

    console.log("🎉 Turnstile resuelto automáticamente (token generado).");
  } catch (err) {
    throw new Error("⚠️ El Turnstile no generó un token en el tiempo esperado.");
  }
}
async function obtenerAsientos(placa, ciudad) {
   const browser = await puppeteer.launch({
    headless:false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // 1. Ir al portal
  await page.goto("https://sprl.sunarp.gob.pe/sprl/ingreso?", {
    waitUntil: "networkidle2"
  });

  // 2. Click en el botón inicial "INGRESAR"
  await page.click("button.login-form-button");
  await page.waitForSelector('form#l-login input[name="username"]');

  // 3. Login
  await page.type('form#l-login input[name="username"]', "USUARIO");
  await page.type('form#l-login input[name="password"]', "CONTRASEÑA");
  await Promise.all([
    page.click('form#l-login button.btn[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle2" })
  ]);

  // 4. Seleccionar ciudad
  await page.click(".ant-select");
await page.waitForSelector(".ant-select-item-option", { visible: true, timeout: 60000 });
  await page.evaluate((ciudad) => {
    const opciones = [...document.querySelectorAll(".ant-select-item-option")];
    const target = opciones.find(opt => opt.innerText.includes(ciudad));
    if (target) target.click();
  }, ciudad);

  // 5. Seleccionar área registral
  await new Promise(r => setTimeout(r, 2000));
  await page.click(".area_registral .ant-select");
  await page.waitForSelector(".ant-select-item-option");
  await page.evaluate(() => {
    const opciones = [...document.querySelectorAll(".ant-select-item-option")];
    const vehicular = opciones.find(opt => opt.innerText.includes("Propiedad Vehicular"));
    if (vehicular) vehicular.click();
  });

  // 6. Ingresar placa
  await page.type("#numero", placa);

  // 7. Resolver captcha


  // 8. Buscar
  const botones = await page.$$('button.ant-btn-primary');
  for (const b of botones) {
    const texto = await page.evaluate(el => el.innerText, b);
    if (texto.includes("Buscar")) {
      await b.click();
      break;
    }
  }

  await page.waitForSelector('table', { timeout: 60000 });

  // 9. Abrir asientos
  const botoness = await page.$$('button.centradoOpciones.ant-btn-primary');
  const botonCorrecto = botoness[botoness.length - 4];
  await page.evaluate(el => el.click(), botonCorrecto);

  await page.waitForSelector('.ant-drawer-body .ant-table', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // 10. Extraer datos principales
  const resultado = await page.evaluate(() => {
    // Cabecera
    const header = {};
    const thead = document.querySelector(".ant-drawer-body .ant-table thead");
    if (thead) {
      const textNodes = [...thead.querySelectorAll("tr")].map(tr => tr.innerText.trim());
      header.orden = textNodes[0] || "";
      header.partida = textNodes[1] || "";
      header.paginas = textNodes[2] || "";
    }

    // Filas de asientos
    const filas = [...document.querySelectorAll('.ant-drawer-body .ant-table tbody tr')];
    const asientos = filas.map(fila => {
      const celdas = fila.innerText.split("\n").map(txt => txt.trim());
      return {
        titulo: celdas[0]?.replace(/^Titulo[:.]?/i, "").trim() || "",
        nroAsiento: celdas[1]?.replace(/^Nro\.? Asiento[:.]?/i, "").trim() || "",
        acto: celdas[2]?.replace(/^Acto[:.]?/i, "").trim() || "",
        anio: celdas[3]?.replace(/^Año[:.]?/i, "").trim() || "",
        paginas: celdas.slice(4).map(p => p.replace(/^Páginas?[:.]?/i, "").trim())
      };
    });

    return { header, asientos };
  });

const filas = await page.$$('.ant-table tbody tr');
const total = resultado.asientos.length; // ✅ número de asientos existentes

for (let i = 0; i < filas.length; i++) {
  const fila = filas[i];

  const icono = await fila.$('.anticon-fund');
  if (!icono) continue;

  await fila.evaluate(el => el.scrollIntoView({ block: 'center' }));

  const prevCount = await page.$$eval('.ant-modal', els => els.length);
  await icono.evaluate(el => el.click());

  await page.waitForFunction((cnt) => {
    return document.querySelectorAll('.ant-modal').length > cnt;
  }, { timeout: 15000 }, prevCount);

  const detalles = await page.evaluate(() => {
    const modals = document.querySelectorAll('.ant-modal');
    const modal = modals[modals.length - 1];
    const info = {};
    if (!modal) return info;

    const rows = modal.querySelectorAll('table tr');
    rows.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 2) {
        const key = tds[0].innerText.replace(/:\s*$/, '').trim();
        const val = tds[1].innerText.trim();
        info[key] = val;
      }
    });
    return info;
  });

  // ✅ Añadimos detalles al asiento correspondiente
  if (resultado.asientos[i-2]) {
    resultado.asientos[i-2].detalles = detalles;
  }

  await page.evaluate(() => {
    const modals = document.querySelectorAll('.ant-modal');
    const modal = modals[modals.length - 1];
    const btnClose = modal?.querySelector('.ant-modal-close');
    btnClose?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  await page.waitForFunction((cnt) => {
    return document.querySelectorAll('.ant-modal').length === cnt;
  }, { timeout: 15000 }, prevCount);

  await new Promise(r => setTimeout(r, 300));
}
  await browser.close();
  return resultado;
}

// Endpoint
app.post("/api/asientos", async (req, res) => {
  const { placa, ciudad } = req.body;
  if (!placa || !ciudad) {
    return res.status(400).json({ error: "Faltan datos: placa o ciudad" });
  }

  try {
    const data = await obtenerAsientos(placa, ciudad);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error al obtener asientos");
  }
});

 // --------- PAPELETAS AREQUIPA ---------

 app.post("/consultar-arequipa", async (req, res) => {
   const { placa } = req.body;
 
   try {
     const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
     const page = await browser.newPage();
 
     await page.goto("https://www.muniarequipa.gob.pe/oficina-virtual/c0nInfrPermisos/faltas/papeletas.php", {
       waitUntil: "networkidle2"
     });
 
     // Ingresar la placa
     await page.type("#placa", placa);
 
      
 
     // Clic en consultar
     await page.click("#btnConsultar");
 
     // Esperar la tabla o fallar rápido si no aparece
     let datos = null;
     try {
       await page.waitForSelector(".col-md-12.table-responsive table", { timeout: 8000 }); // ⏳ max 8s
       datos = await page.evaluate(() => {
         const contenedor = document.querySelector(".col-md-12.table-responsive");
         if (!contenedor) return null;
 
         const encabezados = [...contenedor.querySelectorAll("thead th")].map(th =>
           th.innerText.trim()
         );
 
         const filas = [...contenedor.querySelectorAll("tbody tr")].map(tr =>
           [...tr.querySelectorAll("td")].map(td => td.innerText.trim())
         );
 
         return { encabezados, filas };
       });
     } catch (e) {
       // No apareció la tabla en el tiempo dado
       await browser.close();
       return res.json({ exito: false, mensaje: "No se encontraron papeletas" });
     }
 
     await browser.close();
 
     if (!datos || datos.filas.length === 0) {
       res.json({ exito: false, mensaje: "No se encontraron papeletas" });
     } else {
       res.json({ exito: true, encabezados: datos.encabezados, resultados: datos.filas });
     }
   } catch (err) {
     console.error(err);
     res.status(500).json({ error: "Error al consultar" });
   }
 });
// --------- IMpuesto vehicular ---------
 
async function resolverRecaptcha(page, sitekey, url) {
  console.log("📡 Enviando captcha a 2Captcha...");
  const res = await axios.post("http://2captcha.com/in.php", null, {
    params: {
      key: API_KEY_2CAPTCHA,
      method: "userrecaptcha",
      googlekey: sitekey,
      pageurl: url,
      json: 1,
    },
  });

  if (res.data.status !== 1) throw new Error("❌ Error enviando captcha");

  const requestId = res.data.request;
  console.log("✅ Captcha enviado. ID:", requestId);

  let respuesta;
  for (let i = 0; i < 25; i++) {
    console.log(`⏳ Esperando respuesta captcha... intento ${i + 1}`);
    await new Promise(r => setTimeout(r, 6000));

    const resCheck = await axios.get("http://2captcha.com/res.php", {
      params: {
        key: API_KEY_2CAPTCHA,
        action: "get",
        id: requestId,
        json: 1,
      },
    });

    if (resCheck.data.status === 1) {
      respuesta = resCheck.data.request;
      console.log("🎉 Captcha resuelto:", respuesta.substring(0, 30) + "...");
      break;
    }
  }

  if (!respuesta) throw new Error("❌ No se resolvió el captcha a tiempo");

  await page.evaluate(
    `document.getElementById("g-recaptcha-response").value="${respuesta}";`
  );
}

app.post("/consultarr", async (req, res) => {
  const { placa } = req.body;
  console.log("🔍 Consultando placa:", placa);

   const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  console.log("🌐 Abriendo SAT...");
  await page.goto("https://www.sat.gob.pe/pagosenlinea/", {
    waitUntil: "networkidle2",
  });

  // Seleccionar búsqueda por placa
  await page.select("#strTipDoc", "3");
  await page.type("#strNumDoc", placa);f

  // Resolver captcha
  await resolverRecaptcha(
    page,
    "6Ldy_wsTAAAAAGYM08RRQAMvF96g9O_SNQ9_hFIJ",
    "https://www.sat.gob.pe/pagosenlinea/"
  );

  // Click en buscar (sin waitForNavigation, porque es AJAX)
  console.log("🖱️ Haciendo click en buscar...");
  await page.click("button.btn.btn-primary");

  // Esperar a que aparezcan los resultados
  console.log("⏳ Esperando resultados...");
  await page.waitForSelector("#divimpuestos", { timeout: 30000 });

 
// 2. Esperar al modal
console.log("⏳ Esperando modal de ayuda...");
await page.waitForSelector("#mensajeayuda .button", { visible: true, timeout: 15000 });

// 3. Forzar click vía JS
await page.evaluate(() => {
  document.querySelector("#mensajeayuda .button").click();
});
console.log("✅ Modal 'Entendido' cerrado");

// Esperar que desaparezca el modal
await page.waitForFunction(() => !document.querySelector("#mensajeayuda")?.offsetParent, { timeout: 5000 });

// 4. Expandir los "+"
const botonesMas = await page.$$("#divPapeletas a .toogle.fa-plus");
console.log(`Encontrados ${botonesMas.length} botones "+" para expandir`);

for (const boton of botonesMas) {
  try {
    await boton.click();
    await page.waitForTimeout(800);
  } catch (err) {
    console.log("⚠️ No se pudo expandir fila:", err.message);
  }
}
// ✅ Extraer deuda y cabecera
console.log("📊 Extrayendo deuda...");
const deuda = await page.evaluate(() => {
  const placa = document.querySelector("#valordoc")?.innerText.trim() || "";
  const total = document.querySelector("#montototal")?.innerText.trim() || "S/ 0.00";

  const filas = [...document.querySelectorAll("#divPapeletas .row.gridtree-row")].map(row => {
    const celdas = [...row.querySelectorAll("div")].map(d => d.innerText.trim());

    return {
      falta: celdas[1] || "",
    
      documento: celdas[3] || "",
      fecha: celdas[4] || "",
      monto: celdas[5] || "",
      estado: celdas[6] || "",
    };
  });

  return { placa, total, detalle: filas };
});
 

  await browser.close();
  res.json(deuda);
});
 

// --------- FUNCIONES INDIVIDUALES ---------
async function consultarLima(placa) {
  const SATLIMA_API_KEY = "d6fb31ad4bee4d576b69ceacc98c0b25"; // Clave única
  const SATLIMA_API_URL = "https://2captcha.com";
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  const result = { success: false, results: [] };

  async function resolverCaptchaLima(siteKey, pageUrl) {
    
    const captchaStart = await axios.post(`${SATLIMA_API_URL}/in.php`, null, {
      params: {
        key: SATLIMA_API_KEY,
        method: "userrecaptcha",
        googlekey: siteKey,
        pageurl: pageUrl,
        json: 1,
        priority: 2,         // Prioridad más alta
        soft_id: 123456,     // ID opcional de tu app en 2Captcha
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        recaptchaDataS: "",  // Si el reCAPTCHA tiene data-s
        invisible: 0,
        proxy: "",           // Aquí si quieres usar IP dedicada
      }
    });

    if (captchaStart.data.status !== 1) {
      throw new Error("Error al enviar captcha: " + captchaStart.data.request);
    }

    const captchaId = captchaStart.data.request;
    let token = null;

    // Espera más agresiva: revisa cada 1.5s y corta a los 80s
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const check = await axios.get(`${SATLIMA_API_URL}/res.php`, {
        params: {
          key: SATLIMA_API_KEY,
          action: "get",
          id: captchaId,
          json: 1
        }
      });
      if (check.data.status === 1) {
        token = check.data.request;
        break;
      } else if (check.data.request !== "CAPCHA_NOT_READY") {
        throw new Error("Error resolviendo captcha: " + check.data.request);
      }
    }

    if (!token) {
      console.warn("⚠️ Captcha tardó demasiado, reintentando con nueva key...");
      return resolverCaptchaLima(siteKey, pageUrl);
    }

    return token;
  }

  try {
    

    let frame, recaptchaOk = false;
    for (let intentos = 0; intentos < 5; intentos++) {
      
      await page.goto("https://www.sat.gob.pe/websitev8/Popupv2.aspx?t=8", {
        waitUntil: "domcontentloaded",
         timeout: 60000
      });
      await page.waitForTimeout(3000);

      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(800);
        const frames = page.frames();
        for (const f of frames) {
          const el = await f.$("#tipoBusquedaPapeletas").catch(() => null);
          if (el) {
            frame = f;
            break;
          }
        }
        if (frame) break;
      }

      if (!frame) {
        
        continue;
      }

      const captchaExists = await frame.$('.g-recaptcha').catch(() => null);
      if (captchaExists) {
       
        recaptchaOk = true;
        break;
      } else {
        console.warn("⚠️ CAPTCHA no detectado, recargando...");
        frame = null;
      }
    }

    if (!recaptchaOk) throw new Error("No se pudo cargar el CAPTCHA");

   
    await frame.select("#tipoBusquedaPapeletas", "busqPlaca");
    await frame.waitForSelector("#ctl00_cplPrincipal_txtPlaca", { timeout: 10000 });
    await frame.type("#ctl00_cplPrincipal_txtPlaca", placa);

    const siteKey = "6Ldy_wsTAAAAAGYM08RRQAMvF96g9O_SNQ9_hFIJ";
    const pageUrl = "https://www.sat.gob.pe/websitev8/Popupv2.aspx?t=8";

    const token = await resolverCaptchaLima(siteKey, pageUrl);

    await frame.evaluate((token) => {
      let textarea = document.getElementById("g-recaptcha-response");
      if (!textarea) {
        textarea = document.createElement("textarea");
        textarea.id = "g-recaptcha-response";
        textarea.name = "g-recaptcha-response";
        textarea.style = "display: none;";
        document.body.appendChild(textarea);
      }
      textarea.value = token;
    }, token);

     
    await frame.evaluate(() => {
      __doPostBack("ctl00$cplPrincipal$CaptchaContinue", "");
    });

    await page.waitForTimeout(3500);

  
    await Promise.race([
      frame.waitForSelector("table", { timeout: 15000 }).catch(() => null),
      frame.waitForSelector("#ctl00_cplPrincipal_lblMensaje", { timeout: 15000 }).catch(() => null)
    ]);

    const mensaje = await frame.evaluate(() => {
      const msj = document.querySelector("#ctl00_cplPrincipal_lblMensaje");
      return msj?.innerText.trim().toLowerCase() || "";
    });

    if (mensaje.includes("no se encontraron")) {
      console.log("ℹ️ No se encontraron papeletas.");
      result.success = true;
      result.results = [];
      return result;
    }

    console.log("📋 Extrayendo datos...");
    const tabla = await frame.evaluate(() => {
      const filas = Array.from(document.querySelectorAll("table tr"));
      return filas.slice(1).map((fila) => {
        const celdas = fila.querySelectorAll("td");
        return {
          Placa: celdas[1]?.innerText.trim() || "",
          Reglamento: celdas[2]?.innerText.trim() || "",
          Falta: celdas[3]?.innerText.trim() || "",
          Documento: celdas[4]?.innerText.trim() || "",
          FechaInfraccion: celdas[5]?.innerText.trim() || "",
          Importe: celdas[6]?.innerText.trim() || "",
          Gastos: celdas[7]?.innerText.trim() || "",
          Descuentos: celdas[8]?.innerText.trim() || "",
          Deuda: celdas[9]?.innerText.trim() || "",
          Estado: celdas[10]?.innerText.trim() || ""
        };
      });
    });

    result.success = true;
    result.results = tabla;
    console.log("✅ Consulta completada Lima.");
    
  } catch (err) {
    console.error("❌ Error en consulta Lima:", err.message);
    result.error = err.message;
  } finally {
    await browser.close();
    return result;
  }
}// Endpoint API
app.post("/api/consultar-lima", async (req, res) => {
  const placa = req.body.placa;
  if (!placa) return res.json({ success: false, message: "Placa requerida" });
  const data = await consultarLima(placa);
  res.json(data);
});

async function resolverCaptt(base64Image) {
  const form = new FormData();
  form.append('method', 'base64');
  form.append('key', 'd6fb31ad4bee4d576b69ceacc98c0b25');
  form.append('body', base64Image);
  form.append('json', 1);

  const { data } = await axios.post('http://2captcha.com/in.php', form, {
    headers: form.getHeaders()
  });

  if (data.status !== 1) throw new Error('Error enviando captcha');

  const id = data.request;
  console.log('Esperando resolución del captcha...');

  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await axios.get(`http://2captcha.com/res.php?key=${API_KEY}&action=get&id=${id}&json=1`);
    if (res.data.status === 1) return res.data.request;
    if (res.data.request !== 'CAPCHA_NOT_READY') throw new Error('Error resolviendo captcha');
  }
}
 
app.post('/siniestro', async (req, res) => {
  const placa = req.body.placa;

  try {
  const puppeteer = require("puppeteer");

   const browser = await puppeteer.launch({
  headless: "new", // para evitar la advertencia de deprecated
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    );

    await page.goto('https://servicios.sbs.gob.pe/reportesoat/', {
      waitUntil: 'networkidle2',
    });

    // Escribir placa
    await page.waitForSelector('#ctl00_MainBodyContent_txtPlaca', { visible: true });

    await page.click('#ctl00_MainBodyContent_txtPlaca', { clickCount: 3 });
    await page.type('#ctl00_MainBodyContent_txtPlaca', placa);
       await page.click('#ctl00_MainBodyContent_btnIngresarPla');
await page.evaluate(() => {
  document.querySelector('#ctl00_MainBodyContent_btnIngresarPla').click();
});
   

    // Esperar a que aparezca resultado o mensaje de error
    await page.waitForFunction(() => {
      return document.querySelector('#ctl00_MainBodyContent_cantidad') ||
             document.body.innerText.includes('no se encontró');
    }, { timeout: 35000 });

    // Captura
    const resultado = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerText.trim() : null;
      };

      return {
        placa: getText('#ctl00_MainBodyContent_placa'),
        fechaConsulta: getText('#ctl00_MainBodyContent_fecha_consulta'),
        actualizadoA: getText('#ctl00_MainBodyContent_fecha_act'),
        cantidadAccidentes: getText('#ctl00_MainBodyContent_cantidad'),
      };
    });

    await browser.close();

    if (!resultado.placa) {
      return res.json({ resultado: null });
    }

    res.json({ resultado });

  } catch (error) {
    console.error('Error en siniestro SBS:', error.message);
    res.status(500).json({ error: 'Error consultando siniestros SBS' });
  }
});
app.post('/consultar', async (req, res) => { 
  const placa = req.body.placa;

  try {
    const puppeteer = require('puppeteer');

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    await page.goto('https://webexterno.sutran.gob.pe/WebExterno/Pages/frmRecordInfracciones.aspx', {
      waitUntil: 'networkidle2',
      timeout: 0
    });

    // Ingresar placa
    await page.type('#txtPlaca', placa);

    // Acceder al iframe que contiene el captcha
    const iframeElementHandle = await page.$('#iimage');
    const iframe = await iframeElementHandle.contentFrame();

    // Esperar que la imagen cargue dentro del iframe
    await iframe.waitForSelector('body > img', { timeout: 5000 });

    // Tomar screenshot del captcha dentro del iframe
    const captchaImage = await iframe.$('body > img');
    const captchaBase64 = await captchaImage.screenshot({ encoding: 'base64' });

    // Aquí debes implementar tu función para resolver el captcha (o usar tu servicio)
    const captchaTexto = await resolverCaptt(captchaBase64);
    console.log('Captcha resuelto:', captchaTexto);

    // Ingresar código resuelto
    await page.type('#TxtCodImagen', captchaTexto);

    // Hacer clic en buscar (simula __doPostBack) y esperar navegación
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
      page.evaluate(() => {
        __doPostBack('BtnBuscar', '');
      }),
    ]);

    // Extraer resultado después de que la página se recargue
    const resultado = await page.evaluate(() => {
      const mensaje = document.querySelector('#LblMensaje');
      const tabla = document.querySelector('#gvDeudas');

      if (mensaje && mensaje.innerText.includes('No se encontraron infracciones pendientes')) {
        return 'No se encontraron infracciones pendientes en la SUTRAN.';
      }

      return tabla ? tabla.outerHTML: 'No se encontraron resultados visibles.';
    });

    await browser.close();

    res.json({ resultado: `Resultado para placa ${placa}:\n${resultado}` });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(`<p>Error al consultar: ${error.message}</p><a href="/">Volver</a>`);
  }
});

async function consultarOrdenCapturaSAT(placa) {
  const browser = await puppeteer.launch({
    headless: "new", // para evitar la advertencia de deprecated
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.goto('https://www.sat.gob.pe/VirtualSAT/modulos/Capturas.aspx', { waitUntil: 'networkidle2' });

  await page.type('#ctl00_cplPrincipal_txtPlaca', placa);
  await page.waitForSelector('img.captcha_class', { visible: true });

  const captchaElement = await page.$('img.captcha_class');
  const captchaBuffe = await captchaElement.screenshot();
  const captchaText = await resolverCao(captchaBuffe);

  await page.type('#ctl00_cplPrincipal_txtCaptcha', captchaText);

  await Promise.all([
    page.click('#ctl00_cplPrincipal_CaptchaContinue'),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);

  const errorMsg = await page.$eval('#ctl00_cplPrincipal_lblMensajeCapcha', el => el.innerText).catch(() => '');
  if (errorMsg && errorMsg.trim() !== '') {
    await browser.close();
    throw new Error('CAPTCHA incorrecto o error del sistema');
  }

  const rows = await page.$$eval('#ctl00_cplPrincipal_grdCapturas tr.grillaRows', trs => {
    return trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll('td'));
      return {
        placa: tds[0]?.innerText.trim(),
        documento: tds[1]?.innerText.trim(),
        anio: tds[2]?.innerText.trim(),
        concepto: tds[3]?.innerText.trim(),
        placaOriginal: tds[4]?.innerText.trim(),
        referencia: tds[5]?.innerText.trim(),
        monto: tds[6]?.innerText.trim()
      };
    });
  });

  await browser.close();

  // 👇 AQUÍ el retorno que faltaba
  return rows;
}
async function resolverCao(imageBuffer) {
  const base64 = imageBuffer.toString('base64');
  const formData = new FormData();
  formData.append('method', 'base64');
  formData.append('key', API_KEY);
  formData.append('body', base64);
  formData.append('json', 1);
  formData.append('regsense', 1); 
  formData.append('min_len', 4);
  formData.append('max_len', 4);

  const res = await axios.post('http://2captcha.com/in.php', formData, {
    headers: formData.getHeaders()
  });

  if (res.data.status !== 1) {
    console.error('[ERROR] 2Captcha response:', res.data);
    throw new Error(`Error enviando captcha: ${res.data.request}`);
  }

  const captchaId = res.data.request;
  console.log('[INFO] CAPTCHA enviado. ID:', captchaId);

  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    const res2 = await axios.get(`http://2captcha.com/res.php?key=${API_KEY}&action=get&id=${captchaId}&json=1`);
    console.log('[INFO] Respuesta 2Captcha:', res2.data);

    if (res2.data.status === 1) return res2.data.request;
    if (res2.data.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`Error resolviendo captcha: ${res2.data.request}`);
    }
  }
}
 app.post('/orden-captura', async (req, res) => {
  const { placa } = req.body;

  try {
    const resultados = await consultarOrdenCapturaSAT(placa);
    res.json({ resultado: resultados.length ? resultados : 'No hay órdenes de captura para la placa.' });
  } catch (err) {
    console.error('Error al consultar orden de captura:', err.message);
    res.status(500).json({ resultado: 'Ocurrió un error al consultar la orden de captura.' });
  }
});


 
async function consultarCallao(placa) {
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const page = await browser.newPage();
  const result = { success: false, resultados: [] };

  try {
    await page.goto("https://pagopapeletascallao.pe/", { waitUntil: "networkidle2" });

    const imgCaptcha = await page.$eval('img[src^="data:image"]', img => img.src);
    const formData = new FormData();
    formData.append("key", process.env.CAPTCHA_API_KEY);
    formData.append("method", "base64");
    formData.append("body", imgCaptcha.split(",")[1]);

    const { data } = await axios.post("https://2captcha.com/in.php", formData, {
      headers: formData.getHeaders(),
    });

    if (!data.startsWith("OK|")) throw new Error("No se pudo enviar captcha Callao");
    const captchaId = data.split("|")[1];

    let captchaTexto;
    for (;;) {
     const res = await axios.get(`https://2captcha.com/res.php?key=${process.env.CAPTCHA_API_KEY}&action=get&id=${captchaId}`);
      if (res.data === "CAPCHA_NOT_READY") await new Promise(r => setTimeout(r, 5000));
      else if (res.data.startsWith("OK|")) {
        captchaTexto = res.data.split("|")[1];
        break;
      } else throw new Error("Captcha Callao error: " + res.data);
    }

    await page.type("#valor_busqueda", placa);
    await page.type("#captcha", captchaTexto);
    await Promise.all([
      page.click("#idBuscar"),
      page.waitForNavigation({ waitUntil: "networkidle2" })
    ]);

    const mensajeError = await page.$eval(".mensajeError", el => el.innerText).catch(() => null);
    if (mensajeError) throw new Error("Error Callao: " + mensajeError);

    const tabla = await page.evaluate(() => {
      const filas = [...document.querySelectorAll("table tbody tr")];
      return filas.map(fila => {
        const celdas = [...fila.querySelectorAll("td")];
        return {
          Codigo: celdas[1]?.innerText || "",
          NumeroPapeleta: celdas[2]?.innerText || "",
          FechaInfraccion: celdas[3]?.innerText || "",
          Total: celdas[4]?.innerText || "",
          Beneficio: celdas[5]?.innerText || "",
          DescuentoWeb: celdas[6]?.innerText || "",
          Cuota: celdas[7]?.innerText || "",
          Detalle: celdas[8]?.innerText || "",
          Fraccionarr: celdas[10]?.innerText || "",
        };
      }).filter(r =>
        r.Codigo &&
        !r.Codigo.includes("Valor Insoluto") &&
        !r.Codigo.includes("Sin emisión") &&
        !r.Codigo.includes("90%")
      );
    });

    result.success = true;
    result.resultados = tabla;
  } catch (err) {
    result.error = err.message;
  } finally {
    await browser.close();
    return result;
  }
}
 

// ---------- FUNCIÓN PRINCIPAL ----------

async function consultarRevisionTecnica(placa) {
 const browser = await puppeteer.launch({
  headless: "new", // para evitar la advertencia de deprecated
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});
  const page = await browser.newPage();
  try {
    await page.goto('https://rec.mtc.gob.pe/Citv/ArConsultaCitv', { waitUntil: 'networkidle2' });

    const captchaSrc = await page.$eval('#imgCaptcha', img => img.src);
    const base64Image = captchaSrc.replace(/^data:image\/png;base64,/, '');

    const formData = new FormData();
    formData.append('method', 'base64');
    formData.append('key', process.env.CAPTCHA_API_KEY);
    formData.append('body', base64Image);
    formData.append('json', 1);

    const send = await axios.post('https://2captcha.com/in.php', formData, {
      headers: formData.getHeaders()
    });

    const requestId = send.data.request;
    let captchaResuelto;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const res = await axios.get(`https://2captcha.com/res.php?key=${process.env.CAPTCHA_API_KEY}&action=get&id=${requestId}&json=1`);
      if (res.data.status === 1) {
        captchaResuelto = res.data.request;
        break;
      }
    }
    if (!captchaResuelto) throw new Error("Captcha MTC no resuelto");

    await page.type('#texFiltro', placa);
    await page.type('#texCaptcha', captchaResuelto);
    await page.click('#btnBuscar');
    await page.waitForTimeout(5000);

    const errorMsg = await page.$eval('.msgError', el => el.innerText).catch(() => null);
    if (errorMsg) return { error: errorMsg };

    const resultados = await page.evaluate(() => {
      const rows = document.querySelectorAll('.table tbody tr');
      for (let i = 0; i < rows.length; i++) {
        const cols = rows[i].querySelectorAll('td');
        const item = {
          certificado: cols[0]?.innerText.trim(),
          placa: cols[1]?.innerText.trim(),
          fechaRevision: cols[2]?.innerText.trim(),
          fechaVencimiento: cols[3]?.innerText.trim(),
          resultado: cols[4]?.innerText.trim(),
          planta: cols[5]?.innerText.trim()
        };
        const filledFields = Object.values(item).filter(val => val && val !== "-");
        if (filledFields.length >= 4) return [item];
      }
      return [];
    });

    return { success: true, captcha: captchaResuelto, resultados };
  } catch (error) {
    return { error: error.message };
  } finally {
    await browser.close();
  }
}
// Backend: Node.js con Puppeteer
async function consultarInfogas(placa) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const result = { success: false, resultados: {} };

  try {
    page.setDefaultTimeout(60000); // hasta 1 minuto para casos lentos

   
    await page.goto('https://vh.infogas.com.pe/', { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#inp_ck_plate');
    await page.type('#inp_ck_plate', placa);

    // 🔐 Captcha
    const siteKey = '6LctjAQoAAAAAKxodrxo3QPm033HbyDrLf9N7x7P';
    const pageUrl = 'https://vh.infogas.com.pe/';
    const API_KEYY = process.env.CAPTCHA_API_KEYY;

    
    const { data: request } = await axios.get(`https://2captcha.com/in.php`, {
      params: {
        key: API_KEYY,
        method: "userrecaptcha",
        googlekey: siteKey,
        pageurl: pageUrl,
        json: 1,
        priority: 2,
        bid: 15
      }
    });

    const requestId = request.request;

    const waitForCaptcha = async (requestId) => {
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const { data: response } = await axios.get(`https://2captcha.com/res.php`, {
          params: {
            key: API_KEYY,
            action: "get",
            id: requestId,
            json: 1
          }
        });
        if (response.status === 1) return response.request;
        if (response.request !== 'CAPCHA_NOT_READY') throw new Error("❌ Error en captcha: " + response.request);
      }
      throw new Error('⏱️ Captcha no resuelto a tiempo');
    };

    const token = await waitForCaptcha(requestId);
   

    // Inyectar token
    await page.evaluate((token) => {
      let textarea = document.getElementById("g-recaptcha-response");
      if (!textarea) {
        textarea = document.createElement("textarea");
        textarea.id = "g-recaptcha-response";
        textarea.name = "g-recaptcha-response";
        textarea.style = "display:none;";
        document.body.appendChild(textarea);
      }
      textarea.value = token;
    }, token);

    // Enviar formulario
    await Promise.all([
      page.click('#btn_ck_plate'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    // Esperar hasta que haya datos reales o agotar reintentos
 // Esperar hasta que haya datos reales o agotar reintentos
let data = {};
const maxIntentos = 3;      // Puedes aumentar el número de intentos
const esperaEntreIntentos = 5000; // Tiempo en ms (7 segundos, antes 5s)

for (let intento = 0; intento < maxIntentos; intento++) {
  await page.waitForTimeout(esperaEntreIntentos); // esperar entre intentos

  data = await page.evaluate(() => ({
    vencimientoRevisionAnual: document.querySelector('.plate_item_pran')?.innerText.trim() || '',
    vencimientoCilindro: document.querySelector('.plate_item_pvci')?.innerText.trim() || '',
    tieneCredito: document.querySelector('.plate_item_havc')?.innerText.trim() || '',
    habilitado: document.querySelector('.plate_item_vhab')?.innerText.trim() || '',
    tipoCombustible: document.querySelector('.plate_item_esgnv')?.innerText.trim() || ''
  }));

  // Si ya hay algún dato válido, salir del bucle
  if (Object.values(data).some(v => v && v !== '')) break;

  console.log(`Intento ${intento + 1} sin datos, esperando más...`);
}

if (Object.values(data).some(v => v && v !== '')) {
  result.success = true;
  result.resultados = data;
 
} else {
  result.success = false;
  result.message = 'No se encontraron datos en Infogas';
  console.warn('⚠️ No se encontraron datos tras varios intentos');
}

  } catch (error) {
    console.error('No se encontraron datos en Infogas.', error.message);
    result.error = error.message;
  } finally {
    await browser.close();
    return result;
  }
 
 }app.post("/api/consultar-infogas", async (req, res) => {
  const placa = req.body.placa;
  if (!placa) return res.json({ success: false, message: "Placa requerida" });

  const data = await consultarInfogas(placa);
  res.json(data);
});

// 🔹 SAT TARAPOTO
async function consultarTarapoto(browser, placa) {
  try {
    const page = await browser.newPage();
    await page.goto('https://www.sat-t.gob.pe/', { waitUntil: 'domcontentloaded' });

    // Cierra modal si aparece
    try {
      await page.waitForSelector('.modal-content .close', { timeout: 5000 });
      await page.click('.modal-content .close');
    } catch {}

    await page.waitForSelector('#placa_vehiculo');
    await page.type('#placa_vehiculo', placa);
    await page.click('.btn-warning');
    await page.waitForSelector('#mostrartabla', { timeout: 10000 });

    const datos = await page.evaluate(() => {
      const tabla = document.querySelector('#mostrartabla table');
      if (!tabla) return [];

      const filas = Array.from(tabla.querySelectorAll('tr')).slice(1);
      return filas.map(fila => {
        const celdas = fila.querySelectorAll('td');
        return {
          numero: celdas[0]?.innerText.trim(),
          infraccion: celdas[1]?.innerText.trim(),
          fecha: celdas[2]?.innerText.trim(),
          estado: celdas[3]?.innerText.trim(),
          monto: celdas[4]?.innerText.trim()
        };
      });
    });

    await page.close();
    return datos.length ? datos : 'No se encontraron papeletas';

  } catch (err) {
    return '⚠️ Error en Tarapoto: ' + err.message;
  }
}

// 🔹 SAT HUANCAYO
async function consultarHuancayo(browser, placa) {
  try {
    const page = await browser.newPage();
    await page.goto('http://sathuancayo.fortiddns.com:888/VentanillaVirtual/ConsultaPIT.aspx', {
      waitUntil: 'domcontentloaded'
    });

    await page.waitForSelector('#ContentPlaceHolder1_txtPlaca');
    await page.type('#ContentPlaceHolder1_txtPlaca', placa.toUpperCase());

    await Promise.all([
      page.click('#ContentPlaceHolder1_btnBuscarPlaca'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded' })
    ]);

    await page.waitForSelector('#ContentPlaceHolder1_udpPrincipal', { timeout: 10000 });

    const datos = await page.evaluate(() => {
      const tabla = document.querySelector('#ContentPlaceHolder1_udpPrincipal table');
      if (!tabla) return [];

      const filas = Array.from(tabla.querySelectorAll('tr')).slice(1);
      return filas.map(fila => {
        const celdas = fila.querySelectorAll('td');
        return {
          numero: celdas[0]?.innerText.trim(),
          placa: celdas[1]?.innerText.trim(),
          infraccion: celdas[2]?.innerText.trim(),
          fecha: celdas[3]?.innerText.trim(),
          monto: celdas[4]?.innerText.trim()
        };
      });
    });

    await page.close();
    return datos.length ? datos : 'No se encontraron papeletas';

  } catch (err) {
    return '⚠️ Error en Huancayo: ' + err.message;
  }
}
app.post("/api/atu", async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).json({ error: "Placa requerida" });

  const browser = await puppeteer.launch({
    headless: true, // para ver el navegador y debuguear, puedes poner true en producción
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto("https://sistemas.atu.gob.pe/ConsultaVehiculo/", {
      waitUntil: "networkidle2",
      timeout: 60000,  
    });

    // Aceptar cookies
    try {
      console.log("⏳ Esperando banner de cookies...");
      await page.waitForSelector("div.gdpr-cookie-notice-background", {
        visible: true,
        timeout: 20000,
      });

      const btnAceptar = await page.waitForSelector(
        "a.gdpr-cookie-notice-nav-item-accept",
        { visible: true, timeout: 20000 }
      );

      await btnAceptar.evaluate((btn) => btn.scrollIntoView());
      await btnAceptar.click();
      console.log("🍪 Banner cookies aceptado.");

      // Esperar que desaparezca el banner de cookies
      await page.waitForSelector("div.gdpr-cookie-notice-background", {
        hidden: true,
        timeout: 5000,
      });
      console.log("✅ Banner cookies desaparecido.");
    } catch (error) {
      console.log("⚠️ Banner de cookies no apareció o ya fue aceptado previamente.");
    }

    // Pequeña espera para estabilizar la página tras cerrar banner
    await page.waitForTimeout(1500);

    // Ingresar placa
    console.log("⏳ Esperando input de placa...");
    await page.waitForSelector("#txtNroPlaca", { visible: true, timeout: 15000 });

    console.log("✍️ Escribiendo placa...");
    await page.type("#txtNroPlaca", placa);

    console.log("🖱️ Haciendo click en botón consultar...");
    await page.click("#btnConsultar");

    // Esperar resultado
    try {
      console.log("⏳ Esperando resultado de consulta...");
      await page.waitForSelector("#txtResultPlaca", { timeout: 15000 });
    } catch {
      console.log("ℹ️ Placa no registrada en ATU.");
      return res.json({ registrado: false, mensaje: "ℹ️ Placa no registrada en ATU" });
    }

    // Extraer datos con IDs reales según el HTML que diste
    const data = await page.evaluate(() => {
      const getVal = (id) => document.querySelector(`#${id}`)?.value?.trim() || "";

      const placa = getVal("txtResultPlaca");
      if (!placa) return { registrado: false };

      return {
        registrado: true,
        vehiculo: {
          placa,
          modalidad: getVal("txtResultModalidad"),
          marca: getVal("txtResultMarca"),
          modelo: getVal("txtResultModelo"),
          circulacion: getVal("txtResultOperacion"),
          estado: getVal("txtResultHabilitacion"),
        },
        tarjeta: {
          numero: getVal("txtResultCertificado"),
          fecha_emision: getVal("txtResultFechaEmision"),
          fecha_vencimiento: getVal("txtResultFechaVcto"),
        },
        titular: {
          documento: getVal("txtResultRUC"),
          ruta: getVal("txtResultRUTA"),
          nombre: getVal("txtResultRazon"),
        },
      };
    });

    console.log("✅ Consulta ATU completada.");
    res.json(data);
  } catch (err) {
    console.error("❌ Error en la consulta ATU: ", err.message);
    res.status(500).json({ error: "❌ Error en la consulta ATU: " + err.message });
  } finally {
    await browser.close();
  }
});
async function consultarPapeletasChiclayo(placa) {
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const page = await browser.newPage();

  try {
    // Paso 1: Cargar la página del formulario
    await page.goto('https://virtualsatch.satch.gob.pe/virtualsatch/record_infracciones/buscar_placa_', {
      waitUntil: 'domcontentloaded'
    });

    // Paso 2: Esperar y llenar el campo de placa
    await page.waitForSelector('input[name="search"]', { timeout: 10000 });
    await page.type('input[name="search"]', placa);

    // Paso 3: Enviar el formulario
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded' })
    ]);
   
    // Paso 4: Obtener el HTML del resultado
    const content = await page.content();
    await browser.close();

    // Paso 5: Validar si no hay papeletas
    
   if (content.includes("Su búsqueda no produjo resultados")) {
  return `<h2>Resultados SAT Chiclayo</h2><div class="mensaje-infoo">ℹ️ No se encontraron papeletas <strong>${placa}</strong>.</div>`;
}
    // Si hay resultados, puedes extraerlos o devolver el HTML completo
    return content;

  } catch (error) {
    await browser.close();
    return `<p style="color:red;">❌ Error: ${error.message}</p>`;
  }
}
async function consultarPapeletasHuanuco(placa) {
  const browser = await puppeteer.launch({
  headless: true, // para evitar la advertencia de deprecated
   args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--ignore-certificate-errors" // Ignorar errores SSL
  ]
});
  
  const page = await browser.newPage();

  try {
    // 1. Cargar página
    await page.goto('http://www.munihuanuco.gob.pe/gt_consultapapeletas_placa.php', {
      waitUntil: 'domcontentloaded',
       timeout: 30000,
  ignoreHTTPSErrors: true // Ignorar errores SSL en la navegación
    });
  
    // 2. Esperar campo de placa y escribir
    await page.waitForSelector('#placa', { timeout: 10000 });
    await page.type('#placa', placa);

    // 3. Enviar el formulario (simula Enter)
    await page.keyboard.press('Enter');

    // 4. Esperar que se cargue el div con multas
    await page.waitForSelector('#multas', { timeout: 10000 });

    // 5. Esperar un poco más por si el AJAX aún está cargando
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 6. Extraer el HTML de #multas
    const multasHtml = await page.$eval('#multas', el => el.innerHTML);

    await browser.close();

    if (!multasHtml || multasHtml.includes("no registra multas") || multasHtml.trim() === "") {
      return `<h2>Resultados SAT Huánuco</h2><div class="mensaje-infoo">ℹ️ La placa  <strong>${placa}</strong> no tiene papeletas en Huánuco .</div>`;
    }
   
    return `<h3>Papeletas Huánuco - Placa ${placa}</h3>` + multasHtml;

  } catch (error) {
    await browser.close();
    return `<p style="color:red;">❌ Error Huánuco: ${error.message}</p>`;
  }
}
async function consultarPapeletasChachapoyas(placa) {
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

  const page = await browser.newPage();

  try {
    await page.goto('https://app.munichachapoyas.gob.pe/servicios/consulta_papeletas/app/papeletas.php', {
      waitUntil: 'domcontentloaded'
    });

    await page.waitForSelector('#placa_cnt', { timeout: 10000 });
    await page.type('#placa_cnt', placa);

    await Promise.all([
      page.click('#btnConsulta'),
      page.waitForSelector('#resultado', { timeout: 10000 })
    ]);

    const html = await page.$eval('#resultado', el => el.innerHTML);

    await browser.close();

    if (!html || html.includes('no se encontraron')) {
      return  `<h2>Resultados SAT Chachapoyas</h2><div class="mensaje-infoo">ℹ️ La placa  <strong>${placa}</strong> no tiene papeletas.</div>`;
    }
   
    return  `<h2>Resultados SAT Chachapoyas</h2><div class="mensaje-infoo">ℹ️ La placa  <strong>${placa}</strong> no tiene papeletas.</div>`;

  } catch (error) {
    await browser.close();
    return `<p style="color:red;">❌ Error Chachapoyas: ${error.message}</p>`;
  }
}
async function consultarPapeletasPucallpa(placa) {
 const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const page = await browser.newPage();

  try {
    await page.goto("http://servicios.municportillo.gob.pe:85/consultaVehiculo/consulta/", { waitUntil: "networkidle2" });

    await page.type("#placa", placa);
    await Promise.all([
      page.click("button[type='submit']"),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

    const resultados = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table.table-hover.table-sm tbody tr"));
      return rows.map(row => {
        const cols = row.querySelectorAll("td");
        if (cols.length === 0) return null;
        return {
          placa: cols[0]?.innerText.trim(),
          infraccion: cols[1]?.innerText.trim(),
          fecha: cols[2]?.innerText.trim(),
          infractor: cols[3]?.innerText.trim(),
          propietario: cols[4]?.innerText.trim(),
          situacion: cols[5]?.innerText.trim(),
          destinado: cols[6]?.innerText.trim(),
          papeleta: cols[7]?.innerText.trim(),
          importe: cols[8]?.innerText.trim(),
        };
      }).filter(item => item && Object.values(item).some(val => val && val !== ""));
    });

    await browser.close();

    if (resultados.length === 0) {
      return `<p style="color:green;"><strong>✅ No hay papeletas para la placa ${placa} en Pucallpa.</strong></p>`;
    }

    // Convertimos resultados a tabla HTML
    let tabla = `<h3>Papeletas Pucallpa - Placa ${placa}</h3>`;
    tabla += `<table><thead><tr>
      <th>Placa</th><th>Infracción</th><th>Fecha</th><th>Infractor</th>
      <th>Propietario</th><th>Situación</th><th>Destinado</th><th>Papeleta</th><th>Importe</th>
    </tr></thead><tbody>`;

    resultados.forEach(r => {
      tabla += `<tr>
        <td>${r.placa}</td><td>${r.infraccion}</td><td>${r.fecha}</td><td>${r.infractor}</td>
        <td>${r.propietario}</td><td>${r.situacion}</td><td>${r.destinado}</td><td>${r.papeleta}</td><td>${r.importe}</td>
      </tr>`;
    });

    tabla += `</tbody></table>`;
    return tabla;

  }catch (error) {
  await browser.close();
  return `<h2>Resultados SAT Pucallpa</h2>
    <div class="mensaje-mantenimiento">
      <div class="icono">⚠️</div>
      <h2>Página en Mantenimiento</h2>
      <p>
        El servicio de <strong>Pucallpa</strong> no está disponible en este momento.<br>
        <a href="http://servicios.municportillo.gob.pe:85/consultaVehiculo/consulta/" target="_blank">
           Visitar página oficial
        </a>
      </p>
    </div>
  `;
}
}
  
 async function consultarPapeletasCajamarca(placa) {
 const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'  ]
});
  const page = await browser.newPage();

  try {
    await page.goto('https://www.satcajamarca.gob.pe/consultas', { waitUntil: 'networkidle2' });

    await page.click('a[href="#menu1"]');
    await page.waitForSelector('#opcion_busqueda_record');
    await page.select('#opcion_busqueda_record', '2');

    await page.type('input.form-control.form-control-lg', placa);
    await page.click('button.action-button');

    await page.waitForSelector('table.table', { timeout: 10000 });

    const datos = await page.evaluate(() => {
      const filas = Array.from(document.querySelectorAll('table tbody tr'));
      return filas.map(fila => {
        const cols = fila.querySelectorAll('td');
        return {
          item: cols[0]?.innerText.trim(),
          papeleta: cols[1]?.innerText.trim(),
          fecha: cols[2]?.innerText.trim(),
          codigo: cols[3]?.innerText.trim(),
          conductor: cols[4]?.innerText.trim(),
          infraccion: cols[5]?.innerText.trim(),
          importe: cols[6]?.innerText.trim(),
          estado: cols[7]?.innerText.trim()
        };
      }).filter(p => p.papeleta && p.papeleta.trim() !== '' && p.papeleta.trim().toLowerCase() !== '0.00');
    });

    await browser.close();

    if (!datos.length) {
      return `<p style="color:green;"><strong>✅ No hay papeletas registradas para la placa ${placa} en Cajamarca.</strong></p>`;
    }

    let tabla = `<h3>Papeletas Cajamarca - Placa ${placa}</h3><table><thead>
    <tr><th>Item</th><th>Papeleta</th><th>Fecha</th><th>Código</th>
    <th>Conductor</th><th>Infracción</th><th>Importe</th><th>Estado</th></tr>
    </thead><tbody>`;

    datos.forEach(d => {
      tabla += `<tr>
        <td>${d.item}</td><td>${d.papeleta}</td><td>${d.fecha}</td><td>${d.codigo}</td>
        <td>${d.conductor}</td><td>${d.infraccion}</td><td>${d.importe}</td><td>${d.estado}</td>
      </tr>`;
    });

    tabla += `</tbody></table>`;
    return tabla;

  } catch (error) {
    await browser.close();
    return `<p style="color:red;">❌ Error Cajamarca: ${error.message}</p>`;
  }
}
async function consultarPapeletasCusco(placa) {
const browser = await puppeteer.launch({
  headless: "new",
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const page = await browser.newPage();

  try {
    await page.goto('https://cusco.gob.pe/informatica/index.php/', { waitUntil: 'networkidle2' });
    await page.type('#tx_numero', placa);
    await page.click('#bt_consultar');

    // Intentamos esperar por resultados máximo 5 segundos
    try {
      await page.waitForSelector('#ct_tabla tr', { timeout: 5000 });
    } catch (e) {
      await browser.close();
      return `<h2>Resultados SAT Cusco</h2><div class="mensaje-infoo">ℹ️ La placa  <strong>${placa}</strong> no tiene papeletas en Cusco.</div>`;
    }

    const resultado = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#ct_tabla tr'));
      const data = rows.map(row =>
        Array.from(row.querySelectorAll('td, th')).map(cell => cell.textContent.trim())
      );
      const headers = data[0] || [];
      const body = data.slice(1);
      return { headers, rows: body };
    });

    await browser.close();

    if (resultado.rows.length === 0) {
      return `<h2>Resultados SAT Cusco</h2><div class="mensaje-infoo">ℹ️ La placa  <strong>${placa}</strong> no tiene papeletas en Cusco.</div>`;
    }
 
    let html = `<h3>Papeletas Cusco - Placa ${placa}</h3><table class="styled-table"><thead><tr>`;
    html += resultado.headers.map(h => `<th>${h}</th>`).join('');
    html += `</tr></thead><tbody>`;

    resultado.rows.forEach(row => {
      if (row.length === 1) {
        html += `<tr><td colspan="${resultado.headers.length}" class="detalle">${row[0]}</td></tr>`;
      } else {
        html += `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`;
      }
    });

    html += `</tbody></table>`;
    return html;

  } catch (error) {
    await browser.close();
    return `<p style="color:red;">❌ Error Cusco: ${error.message}</p>`;
  }
}
async function consultarPapeletasIca(placa) {
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

  const page = await browser.newPage();

  try {
    await page.goto("https://m.satica.gob.pe/consultapapeletas_web.php", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.type('input[name="placa"]', placa);
    await Promise.all([
      page.click('button[name="buscar"]'),
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    ]);

    const resultHTML = await page.$eval("body", el => el.innerHTML);
    await browser.close();

    const match = resultHTML.match(/El vehículo no cuenta con papeletas pendientes de pago|<table.*?<\/table>/is);

    if (match) {
      const mensaje = match[0].includes("no cuenta con papeletas")
        ? `<h2>Resultados SAT Ica</h2><div class="mensaje-infoo">ℹ️ La placa  <strong>${placa}</strong> no tiene papeletas en Ica.</div>`
        : `<h3>Papeletas ICA - Placa ${placa}</h3><div class="styled-table-container">${match[0]}</div>`;
      return mensaje;
    } else {
      return "<p style='color:red;'>No se encontraron resultados visibles. Intente nuevamente.</p>";
    }
  } catch (err) {
    await browser.close();
    return `<p style='color:red;'>❌ Error ICA: ${err.message}</p>`;
  }
}
  
async function resolverCapt(imageBase64) {
  const formData = new FormData();
  formData.append('method', 'base64');
  formData.append('key', 'd6fb31ad4bee4d576b69ceacc98c0b25');
  formData.append('body', imageBase64);
  formData.append('json', 1);

  const response = await axios.post('http://2captcha.com/in.php', formData, {
    headers: formData.getHeaders(),
  });

  const { request: captchaId } = response.data;

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await axios.get(`http://2captcha.com/res.php?key=d6fb31ad4bee4d576b69ceacc98c0b25&action=get&id=${captchaId}&json=1`);
    if (res.data.status === 1) return res.data.request;
  }

  throw new Error('Captcha no resuelto a tiempo');
}
 
 async function consultarAndahuaylas(placa) {
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
   const page = await browser.newPage();
 
   try {
     await page.goto('https://muniandahuaylas.gob.pe/consultar-papeleta/', { waitUntil: 'networkidle2' });
 
     await page.type('#nro_placa', placa);
 
     // Captura captcha
     await page.waitForSelector('#captcha img');
     const imageElemen = await page.$('#captcha img');
     const imageBuff= await imageElemen.screenshot();
     const base64Captcha = imageBuff.toString('base64');
 
     const captchaTexto = await resolverCapt(base64Captcha);
     await page.type('#input_captcha', captchaTexto);
 
     // Click en buscar
     await page.click('#buscar');
     await new Promise(resolve => setTimeout(resolve, 4000)); // esperar 4 segundos
 
     // ✅ 1. Verificar si aparece el mensaje de "No se encontraron resultados"
     const mensajeNoEncontrado = await page.evaluate(() => {
       const span = document.querySelector('span[style*="color:Red"]');
       return span ? span.innerText.trim().toLowerCase() : null;
     });
 
     if (mensajeNoEncontrado && mensajeNoEncontrado.includes('no se encontraron resultados')) {
       await browser.close();
       return {
         success: true,
         html: `<p style="color: green; font-weight: bold;">✅ Estaaa placa no tiene papeletas registradas.</p>`
       };
     }
 
   // ✅ 2. Intentar capturar tabla si existe
const tablaHTML = await page.evaluate(() => {
  const tabla = document.querySelector('table');
  return tabla ? tabla.outerHTML : null;
});

await browser.close();

if (tablaHTML) {
  return { success: true, html: tablaHTML };
} else {
  return {
    success: true,
    html: `No hay papeletas para esta placa.`
  };
}
   } catch (err) {
     await browser.close();
     return { success: false, error: err.message };
   }
 }
 
async function consultarPapeletasPuno(placa) {
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

  const page = await browser.newPage();

  try {
    await page.goto('https://papeletas.munipuno.gob.pe/licencias', {
      waitUntil: 'networkidle2',
    });

    await page.waitForSelector('input[placeholder="Ingrese una placa"]');
    await page.type('input[placeholder="Ingrese una placa"]', placa);

    await Promise.all([
      page.click('button[type="submit"]'),
      new Promise(resolve => setTimeout(resolve, 3000)), // reemplazo de waitForTimeout
    ]);

    const resultado = await page.evaluate(() => {
      const modal = document.querySelector('.swal2-title');
      if (modal && modal.textContent.includes('NO AUTORIZADO')) {
        return 'NO_HAY_PAPELETAS';
      }

      const tabla = document.querySelector('table tbody');
      if (!tabla || tabla.children.length === 0) {
        return 'NO_HAY_PAPELETAS';
      }

      return 'HAY_RESULTADOS';
    });

    await browser.close();
    return resultado;
  } catch (err) {
    console.error('❌ Error consultando Puno:', err.message);
    await browser.close();
    return 'ERROR';
  }
}

 
module.exports = consultarPapeletasPuno;
 
app.post('/api/puno', async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).json({ error: 'Placa requerida' });

  const resultado = await consultarPapeletasPuno(placa);

  if (resultado === 'HAY_RESULTADOS') {
    res.json({ tienePapeletas: true, mensaje: 'Hay papeletas registradas en Puno' });
  } else if (resultado === 'NO_HAY_PAPELETAS') {
    res.json({ tienePapeletas: false, mensaje: 'No hay papeletas en Puno' });
  } else {
    res.status(500).json({ error: 'Error al consultar papeletas en Puno' });
  }
});
 
 app.post('/api/andahuaylas', async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).json({ error: 'Placa requerida' });

  const resultado = await consultarAndahuaylas(placa);
  res.json(resultado);
});
 
app.post("/api/ica", async (req, res) => {
  const { placa } = req.body;
  const resultado = await consultarPapeletasIca(placa);
  res.send(resultado);
});
app.post('/api/cusco', async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).send('Falta ingresar la placa');

  const resultado = await consultarPapeletasCusco(placa);
  res.send(resultado);
});
app.post('/api/cajamarca', async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).send('Falta ingresar la placa');

  const resultado = await consultarPapeletasCajamarca(placa);
  res.send(resultado);
});
app.post('/api/pucallpa', async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).send('Falta ingresar la placa');
  const resultado = await consultarPapeletasPucallpa(placa);
  res.send(resultado);
});
app.post('/api/chachapoyas', async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).send('Falta ingresar la placa');

  const resultado = await consultarPapeletasChachapoyas(placa);
  res.send(resultado);
});
app.post('/api/chiclayo', async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).send('Falta ingresar la placa');

  const resultado = await consultarPapeletasChiclayo(placa);
  res.send(resultado);
});
app.post('/api/huanuco', async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).send('Falta ingresar la placa');

  const resultado = await consultarPapeletasHuanuco(placa);
  res.send(resultado);
});
 
app.post('/consultarpiura', async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).json({ error: 'Placa requerida' });

  try {
    console.log('Lanzando navegador piiiurra...');
const browser = await puppeteer.launch({
  headless: true, // o true
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});

    const page = await browser.newPage(); // ← FALTABA ESTA LÍNEA

    console.log('Abriendo página principal...');
    await page.goto('http://www.munipiura.gob.pe/consulta-de-multas-de-transito', {
      waitUntil: 'domcontentloaded'
    });

    console.log('Esperando botón por placa...');
    await page.waitForSelector('a#tab-buscar-por-placa');

    console.log('Click botón por placa...');
    await page.click('a#tab-buscar-por-placa');

    console.log('Esperando input de placa...');
    await page.waitForSelector('input[name="PlaMot"]');

    console.log('Escribiendo placa...');
    await page.type('input[name="PlaMot"]', placa);

    console.log('Abriendo URL directa de resultados...');
    const urlConsulta = `http://www2.munipiura.gob.pe/institucional/transparencia/transitoxplamot.asp?PlaMot=${placa}`;
    console.log('URL:', urlConsulta);

    const resultPage = await browser.newPage();
    await resultPage.goto(urlConsulta, { waitUntil: 'domcontentloaded' });

    console.log('Esperando cuerpo...');
    await resultPage.waitForSelector('body');

    console.log('Extrayendo datos...');
    const datos = await resultPage.evaluate(() => {
      const texto = document.body.innerText.trim();
      if (texto.includes('Se encontraron 0 coincidencias')) {
        return { sinPapeletas: true, data: 'ℹ️No se encontraron papeletas.' };
      }

      const filas = Array.from(document.querySelectorAll('table tr'))
        .map(tr => Array.from(tr.cells).map(td => td.innerText.trim()))
        .filter(f => f.length > 1);

      return { sinPapeletas: false, data: filas };
    });

    await browser.close();
    res.json(datos);

  } catch (error) {
    console.error('Error al consultar:', error);
     throw error; 
    res.status(500).json({ error: 'Falló la consulta', detalles: error.message });
  }
});

// ---------- RESOLVER CAPTCHA CON 2CAPTCHA ----------
async function resolverCaptcha(imageBase64) {
  const formData = new FormData();
  formData.append("method", "base64");
  formData.append("key", API_KEY_2CAPTCHA);
  formData.append("body", imageBase64);
  formData.append("json", 1);

  const { data: response } = await axios.post("http://2captcha.com/in.php", formData, {
    headers: formData.getHeaders(),
  });

  if (response.status !== 1) {
    throw new Error("Error al enviar captcha a 2Captcha: " + response.request);
  }

  const captchaId = response.request;

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const { data: res } = await axios.get(
      `http://2captcha.com/res.php?key=${API_KEY_2CAPTCHA}&action=get&id=${captchaId}&json=1`
    );

    if (res.status === 1) {
      return res.request.toUpperCase(); // Siempre en mayúscula
    }

    if (res.request === "ERROR_CAPTCHA_UNSOLVABLE") {
      throw new Error("Captcha no resolvible");
    }
  }

  throw new Error("Captcha no resuelto a tiempo");
}

// ---------- FUNCIÓN PRINCIPAL ----------
async function consultarPapeletasTacna(placa) {
  const puppeteer = require("puppeteer");
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

  try {
    const page = await browser.newPage();
    console.log("Abriendo página...");
    await page.goto("https://www.munitacna.gob.pe/pagina/sf/servicios/papeletas", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await page.waitForSelector("#opcion", { visible: true });
    await page.select("#opcion", "placa");
    await page.type("#busca", placa);

    // Esperar que el captcha cargue
    await page.waitForSelector(".img-captcha", { visible: true });
    await page.waitForFunction(() => {
      const img = document.querySelector(".img-captcha");
      return img && img.src && img.src.length > 50 && !img.src.includes("data:image/gif");
    }, { timeout: 15000 });

    // Capturar imagen en base64
    const captchaElement = await page.$(".img-captcha");
    await page.waitForTimeout(2000); // Espera extra por seguridad
    const base64Captcha = await captchaElement.screenshot({ encoding: "base64" });

    // Guardar para debug
    fs.writeFileSync("captcha-tacna.png", Buffer.from(base64Captcha, "base64"));

    // Resolver captcha
    const captchaTexto = await resolverCaptcha(base64Captcha);
    console.log("Captcha resuelto:", captchaTexto);
    await page.type("#codigo", captchaTexto);

    // Click en consultar
    await page.click("button.btn-danger");

    // Esperar resultados o mensaje
    await page.waitForFunction(() => {
      const tabla = document.querySelector(".table");
      const sinDatos = document.querySelector("p");
      return tabla || (sinDatos && sinDatos.innerText.toUpperCase().includes("NO SE ENCONTRARON DATOS"));
    }, { timeout: 20000 });

    // Extraer datos
    const resultado = await page.evaluate(() => {
      const tabla = document.querySelector(".table");
      const mensaje = document.querySelector("p");

      if (!tabla && mensaje && mensaje.innerText.toUpperCase().includes("NO SE ENCONTRARON DATOS")) {
        return { mensaje: "No hay papeletas" };
      }

      if (tabla) {
        const filas = Array.from(tabla.querySelectorAll("tbody tr"))
          .filter(fila => fila.querySelectorAll("td").length > 1);

        if (filas.length === 0) {
          return { 
  mensaje: '<h2>Resultados SAT Tacna</h2><div class="mensaje-infoo">ℹ️ No se encontraron papeletas.</div>' 
};
        }

        return filas.map(fila => {
          const celdas = Array.from(fila.querySelectorAll("td")).map(td => td.innerText.trim());
          return {
            fecha: celdas[0] || "",
            estado: celdas[1] || "",
            numeroPapeleta: celdas[2] || "",
            anio: celdas[3] || "",
            codInfraccion: celdas[4] || "",
            propietario: celdas[5] || "",
            dniPropietario: celdas[6] || "",
            infractor: celdas[7] || "",
            dniInfractor: celdas[8] || "",
            licencia: celdas[9] || "",
            importe: celdas[10] || "",
          };
        });
      }

      return { mensaje: "No hay papeletas" };
    });

    return resultado;
  } catch (err) {
    throw new Error("Error en el proceso: " + err.message);
  } finally {
    await browser.close();
  }
}

// ---------- RUTA DE API ----------
app.post("/consultartacna", async (req, res) => {
  const { placa } = req.body;
  if (!placa) return res.status(400).json({ error: "Placa requerida" });

  try {
    const resultado = await consultarPapeletasTacna(placa);
    return res.json(resultado);
  } catch (err) {
    return res.status(500).json({ error: "Error al consultar: " + err.message });
  }
});
 
// --------- RUTAS API ---------

 
app.post("/api/consultar-callao", async (req, res) => {
  const placa = req.body.placa;
  if (!placa) return res.json({ success: false, message: "Placa requerida" });
  const data = await consultarCallao(placa);
  res.json(data);
});

app.post("/api/consultar-revision", async (req, res) => {
  const placa = req.body.placa;
  if (!placa) return res.json({ success: false, message: "Placa requerida" });
  const data = await consultarRevisionTecnica(placa);
  res.json(data);
});
 
app.post("/api/consultar", async (req, res) => {
  const { placa } = req.body;
  if (!placa || placa.trim().length < 5) {
    return res.status(400).json({ error: '❌ Placa inválida' });
  }

const browser = await puppeteer.launch({
  headless: "new", // para evitar la advertencia de deprecated
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

  try {
    const [tarapoto, huancayo] = await Promise.all([
      consultarTarapoto(browser, placa),
      consultarHuancayo(browser, placa)
    ]);

    res.json({
      placa,
      tarapoto,
      huancayo
    });

  } catch (err) {
    res.status(500).json({ error: '❌ Error general: ' + err.message });
  } finally {
    await browser.close();
  }
});
// 🔹 piura

 
// --------- INICIO ---------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en http://localhost:${PORT}`);
});