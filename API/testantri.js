const fetch = global.fetch;

const API_URL = "https://mst.it-cpi002-rt.cfapps.ap10.hana.ondemand.com/http/timesheet_QA";
const USERNAME = "sb-536163d0-4359-40c4-8d17-07ec0fd8d3e1!b672|it-rt-mst!b80";
const PASSWORD = "74a46ba6-2c31-4116-814f-4c6af186581f$og9p7Ha3hijivoXXMChQBTEyBAxnfJWZQsvVjjFVx6k=";

// Encode Basic Auth
const basicAuth = "Basic " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");


const payloads = [
  {
    "ZTIMESHEETID": "556",
    "PERNR": "00016502",
    "RUECK": "",
    "ZCONF_TYPE": "",
    "ARBPL": "M5153ASY",
    "LSTAR": "1770",
    "ISDD": "20250918",
    "ISDZ": "153800",
    "IEDD": "20250918",
    "IEDZ": "205900",
    "WERKS": "5153",
    "AUERU": "",
    "ZBARCODEID": "1575343"
  },
  {
    "ZTIMESHEETID": "557",
    "PERNR": "00016502",
    "RUECK": "",
    "ZCONF_TYPE": "",
    "ARBPL": "M5153ASY",
    "LSTAR": "1770",
    "ISDD": "20250919",
    "ISDZ": "080000",
    "IEDD": "20250919",
    "IEDZ": "120000",
    "WERKS": "5153",
    "AUERU": "",
    "ZBARCODEID": "1575344"
  },
  {
    "ZTIMESHEETID": "558",
    "PERNR": "00016502",
    "RUECK": "",
    "ZCONF_TYPE": "",
    "ARBPL": "M5153ASY",
    "LSTAR": "1770",
    "ISDD": "20250920",
    "ISDZ": "083000",
    "IEDD": "20250920",
    "IEDZ": "113000",
    "WERKS": "5153",
    "AUERU": "",
    "ZBARCODEID": "1575345"
  },
  {
    "ZTIMESHEETID": "559",
    "PERNR": "00016502",
    "RUECK": "",
    "ZCONF_TYPE": "",
    "ARBPL": "M5153ASY",
    "LSTAR": "1770",
    "ISDD": "20250921",
    "ISDZ": "090000",
    "IEDD": "20250921",
    "IEDZ": "130000",
    "WERKS": "5153",
    "AUERU": "",
    "ZBARCODEID": "1575346"
  },
  {
    "ZTIMESHEETID": "560",
    "PERNR": "00016502",
    "RUECK": "",
    "ZCONF_TYPE": "",
    "ARBPL": "M5153ASY",
    "LSTAR": "1770",
    "ISDD": "20250922",
    "ISDZ": "100000",
    "IEDD": "20250922",
    "IEDZ": "140000",
    "WERKS": "5153",
    "AUERU": "",
    "ZBARCODEID": "1575347"
  }
];


function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendData() {
  for (let i = 0; i < payloads.length; i++) {
    const data = payloads[i];

    console.log(`\n Sending data ${i + 1} of ${payloads.length}...`);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Authorization": basicAuth,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      });

      const text = await response.text();

      console.log("STATUS:", response.status);
      console.log("RESPONSE:", text);
    } catch (err) {
      console.error(" Error:", err.message);
    }

    if (i < payloads.length - 1) {
      console.log("Waiting 8 seconds...");
      await delay(8000); 
    }
  }

  console.log("\n All data sent!");
}

sendData();
