const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const data = [
  ["Name"],
  ["Apple"],
  ["Microsoft"],
  ["Tesla"],
  ["Google"],
  ["Amazon"]
];

const ws = xlsx.utils.aoa_to_sheet(data);
const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, "Companies");

const outputPath = path.join(__dirname, '..', 'companies_to_screen.xlsx');
xlsx.writeFile(wb, outputPath);
console.log("Excel file created at: " + outputPath);
