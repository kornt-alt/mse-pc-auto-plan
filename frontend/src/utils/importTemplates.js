// Master template สำหรับหน้า Import Data
//   - downloadTemplate(spec): สร้างไฟล์ .xlsx "หัวตารางอย่างเดียว" (ไม่มีแถวข้อมูล) ให้ผู้ใช้กรอกแล้วอัปโหลดได้เลย
//   - ตัวอย่างข้อมูล + วิธีกรอก แสดงบนหน้าเว็บ (Modal) ไม่ฝังในไฟล์ (ผู้ใช้เลือกแบบนี้ 2026-08-03)
// ⚠️ header ต้องตรง case เป๊ะกับที่ backend/routes/uploads.js อ่าน (calendar/machines/routing = PascalCase,
//    orders/actual_result/product_master = lowercase) — handler อ่านคอลัมน์ตรง ๆ ไม่ผ่าน getValueStrict
import * as XLSX from 'xlsx';

// col: { name, required, format, default, example, note }
export const TEMPLATE_SPECS = {
  orders: {
    id: 'orders',
    title: 'Orders',
    filename: 'template_orders.xlsx',
    sheetName: 'orders',
    columns: [
      { name: 'batch', required: true, format: 'ข้อความ', example: 'B2024-001', note: 'ห้ามซ้ำกับ batch เดิม (ระบบข้ามตัวซ้ำ)' },
      { name: 'model', format: 'ข้อความ', example: 'MDL-123' },
      { name: 'description', format: 'ข้อความ (ไทยได้)', example: 'ชิ้นงานเหล็ก' },
      { name: 'due_date', format: 'YYYY-MM-DD', example: '2024-12-31', note: 'ว่างได้ (= ไม่กำหนด)' },
      { name: 'qty', format: 'ตัวเลข', default: '0', example: '100' },
      { name: 'plan_mode', format: 'NEW / FIXED', default: 'NEW', example: 'NEW' },
      { name: 'wip_flow_index', format: 'จำนวนเต็ม', default: '0', example: '0' },
      { name: 'wip_start_step_index', format: 'จำนวนเต็ม', default: '0', example: '0' },
      { name: 'wip_finish_date', format: 'YYYY-MM-DD', example: '', note: 'ว่างได้' },
      { name: 'wip_machine', format: 'ข้อความ', example: '', note: 'ว่างได้' },
      { name: 'planning_mode', format: 'forward / backward', default: 'forward', example: 'forward' },
      { name: 'release_date', format: 'YYYY-MM-DD', example: '', note: 'ว่างได้' },
      { name: 'is_deleted', format: '0 / 1', default: '0', example: '0' },
      { name: 'is_new', format: '0 / 1', default: '1', example: '1' },
    ],
  },
  calendar: {
    id: 'calendar',
    title: 'Calendar',
    filename: 'template_calendar.xlsx',
    sheetName: 'calendar',
    columns: [
      { name: 'Machine', required: true, format: 'ข้อความ', example: 'CNC-01' },
      { name: 'Date', required: true, format: 'YYYY-MM-DD', example: '2024-06-01' },
      { name: 'AvailableTime', format: 'ตัวเลข (นาที)', default: '0', example: '480' },
    ],
  },
  machines: {
    id: 'machines',
    title: 'Machine Config',
    filename: 'template_machines.xlsx',
    sheetName: 'machines',
    columns: [
      { name: 'Model', required: true, format: 'ข้อความ', example: 'MDL-123' },
      { name: 'FlowIndex', format: 'จำนวนเต็ม', default: '0', example: '1' },
      { name: 'StepIndex', format: 'จำนวนเต็ม', default: '0', example: '1' },
      { name: 'AlternativeIndex', format: 'จำนวนเต็ม', default: '0', example: '0' },
      { name: 'Machine', format: 'ข้อความ', example: 'CNC-01' },
      { name: 'CycleTime', format: 'ตัวเลข (นาที/ชิ้น)', default: '0', example: '2.5' },
      { name: 'SetupTime', format: 'ตัวเลข (นาที)', default: '0', example: '30' },
      { name: 'JigID', format: 'ข้อความ', default: '-', example: 'JIG-01' },
    ],
  },
  routing: {
    id: 'routing',
    title: 'Routing',
    filename: 'template_routing.xlsx',
    sheetName: 'routing',
    columns: [
      { name: 'Model', required: true, format: 'ข้อความ', example: 'MDL-123' },
      { name: 'FlowIndex', format: 'จำนวนเต็ม', default: '0', example: '1' },
      { name: 'StepIndex', format: 'จำนวนเต็ม', default: '0', example: '1' },
      { name: 'StepName', format: 'ข้อความ', example: 'กลึง' },
      { name: 'SetupGroup', format: 'ข้อความ', example: 'G1' },
    ],
  },
  actual_result: {
    id: 'actual_result',
    title: 'Actual Result',
    filename: 'template_actual_result.xlsx',
    sheetName: 'actual_result',
    note: 'ต้องมี (batch, process_step, machine) ตรงกับแผน (schedule_results) มิฉะนั้นรายการจะถูกปัดตก',
    columns: [
      { name: 'employee', format: 'ข้อความ', example: 'EMP001' },
      { name: 'batch', required: true, format: 'ข้อความ', example: 'B2024-001' },
      { name: 'process_step', required: true, format: 'ข้อความ', example: 'กลึง', note: 'ต้องตรงกับแผน' },
      { name: 'machine', required: true, format: 'ข้อความ', example: 'CNC-01', note: 'ต้องตรงกับแผน' },
      { name: 'qty_ok', format: 'ตัวเลข', default: '0', example: '95' },
      { name: 'qty_ng', format: 'ตัวเลข', default: '0', example: '5' },
      { name: 'mode_ng', format: 'ข้อความ', example: 'รอยขีด' },
      { name: 'working_date', format: 'YYYY-MM-DD', example: '2024-06-01' },
      { name: 'working_shift', format: 'ข้อความ', example: 'A' },
    ],
  },
  product_master: {
    id: 'product_master',
    title: 'Product Master',
    filename: 'template_product_master.xlsx',
    sheetName: 'product_master',
    note: 'แบบ upsert (เพิ่ม/อัปเดตตาม model) ต้องมีครบทั้ง 5 คอลัมน์ในหัวตาราง',
    columns: [
      { name: 'model', required: true, format: 'ข้อความ', example: 'MDL-123' },
      { name: 'description', format: 'ข้อความ (ไทยได้)', example: 'ชิ้นงาน A' },
      { name: 'setup_group', format: 'ข้อความ', example: 'G1' },
      { name: 'dept_code', format: 'ข้อความ', example: 'D01' },
      { name: 'product_code', format: 'ข้อความ', example: 'P123' },
    ],
  },
};

// ดาวน์โหลดไฟล์ .xlsx หัวตารางแถวเดียว (ไม่มีข้อมูล)
export const downloadTemplate = (spec) => downloadRows(spec, []);

// ดาวน์โหลด .xlsx: header (ตาม spec.columns) + data (rows = array ของ object keyed by ชื่อคอลัมน์)
export const downloadRows = (spec, rows) => {
  const header = spec.columns.map((c) => c.name);
  const body = rows.map((row) => spec.columns.map((c) => row[c.name] ?? ''));
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);
  XLSX.writeFile(wb, spec.filename);
};

// แถวตัวอย่าง (colName → example) สำหรับโชว์บนเว็บ
export const exampleRow = (spec) =>
  spec.columns.map((c) => ({ name: c.name, value: c.example ?? '' }));

// ===== Generator (pure) — สร้าง data rows ให้ downloadRows =====

// Calendar: machine × date (available_time เว้นว่างให้กรอก หรือ defaultTime)
export const buildCalendarRows = (machines, dates, defaultTime = '') =>
  dates.flatMap((date) => machines.map((m) => ({ Machine: m, Date: date, AvailableTime: defaultTime })));

// Machine/Routing skeleton จากโครง flows — index 0-based (flow แรก=0, step แรก=0, primary alt=0)
// flows = [{ steps: [{ alts: n }] }]  (alts ใช้เฉพาะ machine_config; routing ไม่มี alternative)
// withAlternatives=true → machine_config columns, false → routing_config columns
export const buildConfigRows = ({ withAlternatives }, model, flows) => {
  const out = [];
  flows.forEach((flow, flowIdx) => {
    (flow.steps || []).forEach((step, stepIdx) => {
      if (withAlternatives) {
        const alts = Math.max(1, Number(step.alts) || 1);
        for (let a = 0; a < alts; a += 1) {
          out.push({
            Model: model,
            FlowIndex: flowIdx,
            StepIndex: stepIdx,
            AlternativeIndex: a,
            Machine: '',
            CycleTime: '',
            SetupTime: '',
            JigID: '-',
          });
        }
      } else {
        out.push({
          Model: model,
          FlowIndex: flowIdx,
          StepIndex: stepIdx,
          StepName: '',
          SetupGroup: '',
        });
      }
    });
  });
  return out;
};

// Actual Result: จาก { batch: [{process_step, machine}] } → แถวพร้อมกรอก qty/คน/วัน/กะ
export const buildActualRows = (planByBatch) => {
  const out = [];
  for (const [batch, steps] of Object.entries(planByBatch || {})) {
    for (const s of steps || []) {
      out.push({
        employee: '',
        batch,
        process_step: s.process_step,
        machine: s.machine,
        qty_ok: '',
        qty_ng: '',
        mode_ng: '',
        working_date: '',
        working_shift: '',
      });
    }
  }
  return out;
};
