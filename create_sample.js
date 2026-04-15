const XLSX = require('xlsx');
const path = require('path');

async function createSample() {
  const data = [
    ["Product or Company Name", "Details", "URL"],
    ["iPhone 15 Pro", "", ""],
    ["Tesla Inc", "", ""],
    ["Nike shoes", "", ""],
    ["Microsoft Corporation", "", ""]
  ];
  
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Search Terms");
  
  const filePath = path.join('c:/Search', 'sample_input.xlsx');
  XLSX.writeFile(workbook, filePath);
  console.log(`Created sample input file at ${filePath}`);
}

createSample();
