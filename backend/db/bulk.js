// INSERT หลายแถวใน transaction แบบ chunk — mssql จำกัด ~2100 params ต่อ statement
// t = helpers จาก transaction(fn), rows = array ของ array ค่าตามลำดับ columns
const bulkInsert = async (t, table, columns, rows) => {
  if (rows.length === 0) return;
  const chunkSize = Math.max(1, Math.floor(2000 / columns.length));
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params = {};
    const values = chunk
      .map(
        (row, r) =>
          `(${columns
            .map((c, ci) => {
              const p = `p${r}_${ci}`;
              params[p] = row[ci];
              return `@${p}`;
            })
            .join(',')})`
      )
      .join(',');
    await t.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`, params);
  }
};

module.exports = { bulkInsert };
