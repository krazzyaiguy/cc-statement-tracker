import * as XLSX from "xlsx";

export function exportToExcel(records){
  const headers=["#","Cardholder","Bank","Last 4","Statement Date","Due Date","Amount","Currency","Received","Source","Status"];
  const rows=records.map((r,i)=>[i+1,r.cardholderName||"",r.bankName||"",r.lastFourDigits||"",r.statementDate||"",r.dueDate||"",r.dueAmount??"",r.currency||"",r.receivedOn||"",r.source||"manual",r.paid?"PAID":"PENDING"]);
  const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
  ws["!cols"]=[{wch:4},{wch:20},{wch:18},{wch:10},{wch:16},{wch:16},{wch:14},{wch:10},{wch:14},{wch:10},{wch:10}];
  XLSX.utils.book_append_sheet(wb,ws,"CC Statements");
  XLSX.writeFile(wb,`CC_Statements_${new Date().toISOString().slice(0,10)}.xlsx`);
}
