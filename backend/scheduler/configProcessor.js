// Port 1:1 จาก OLD_BACKUP\backend\scheduler_core.py L49-140 (class ConfigProcessor)
// pure functions — ห้าม import DB / clock
// โครงสร้าง output: { [model]: Map<flow, { [step]: value }> }
// ระดับ flow ต้องเป็น Map เพื่อคง insertion order แบบ Python dict — engine ใช้
// next(iter(available_flows)) เลือก flow แรกตามลำดับ insert ซึ่ง JS object
// จะ reorder คีย์ตัวเลขเป็น ascending เอง (พฤติกรรมต่างจาก Python)
// ระดับ step เป็น object ธรรมดา — ผู้อ่าน iterate ด้วย sortedNumericKeys เสมอ
'use strict';

const { isDigit, pyInt, pyFloat } = require('./pyUtils');

// get_value_strict (L53-58): lookup คีย์แบบ case-insensitive + trim
function getValueStrict(row, keyName) {
  const target = String(keyName).toLowerCase().trim();
  for (const [k, v] of Object.entries(row)) {
    if (String(k).toLowerCase().trim() === target) return v;
  }
  return null;
}

// process_routing (L60-75): rows → { model: { flow: { step: stepName } } }
function processRouting(flatData) {
  const output = {};
  for (const row of flatData) {
    const model = getValueStrict(row, 'Model');
    const rawFlow = getValueStrict(row, 'FlowIndex');
    const flow = rawFlow && isDigit(rawFlow) ? pyInt(rawFlow) : 0;
    let step = getValueStrict(row, 'StepIndex');
    const stepName = getValueStrict(row, 'StepName');

    if (!model || step === null || step === undefined || !stepName) continue;

    step = pyInt(step);
    if (!(model in output)) output[model] = new Map();
    if (!output[model].has(flow)) output[model].set(flow, {});
    output[model].get(flow)[step] = stepName;
  }
  return output;
}

// process_unified_machine_config (L77-140):
// rows → { fixedMachine, cycleTime, setupConfig } โดย setupConfig value = {time, jig}
// key model|flow|step ที่มี >1 row (มี alternative) → value เป็น list index ตาม
// AlternativeIndex, pad ด้วย null (ตรง Python ที่ pad ด้วย None)
function processUnifiedMachineConfig(flatData) {
  const fmOut = {};
  const ctOut = {};
  const stOut = {};

  const altCheck = new Map(); // defaultdict(int)

  for (const row of flatData) {
    const model = getValueStrict(row, 'Model');
    const rawFlow = getValueStrict(row, 'FlowIndex');
    const flow = rawFlow && isDigit(rawFlow) ? pyInt(rawFlow) : 0;
    const step = getValueStrict(row, 'StepIndex');
    if (!model || step === null || step === undefined) continue;
    const key = `${model}|${flow}|${pyInt(step)}`;
    altCheck.set(key, (altCheck.get(key) || 0) + 1);
  }

  for (const row of flatData) {
    const model = getValueStrict(row, 'Model');
    const rawFlow = getValueStrict(row, 'FlowIndex');
    const flow = rawFlow && isDigit(rawFlow) ? pyInt(rawFlow) : 0;
    let step = getValueStrict(row, 'StepIndex');
    const rawAlt = getValueStrict(row, 'AlternativeIndex');
    const alt = rawAlt && isDigit(rawAlt) ? pyInt(rawAlt) : 0;

    if (!model || step === null || step === undefined) continue;
    step = pyInt(step);

    const macVal = getValueStrict(row, 'Machine');
    let ctVal;
    try {
      ctVal = pyFloat(getValueStrict(row, 'CycleTime'));
    } catch {
      ctVal = 0.0;
    }

    let stVal;
    try {
      stVal = pyFloat(getValueStrict(row, 'SetupTime'));
    } catch {
      stVal = 0.0;
    }
    const rawJig = getValueStrict(row, 'JigID');
    const stDict = { time: stVal, jig: rawJig || '-' };

    for (const outDict of [fmOut, ctOut, stOut]) {
      if (!(model in outDict)) outDict[model] = new Map();
      if (!outDict[model].has(flow)) outDict[model].set(flow, {});
    }

    const fmFlow = fmOut[model].get(flow);
    const ctFlow = ctOut[model].get(flow);
    const stFlow = stOut[model].get(flow);

    const key = `${model}|${flow}|${step}`;

    if (altCheck.get(key) <= 1) {
      if (macVal !== null && macVal !== undefined) fmFlow[step] = macVal;
      ctFlow[step] = ctVal;
      stFlow[step] = stDict;
    } else {
      if (macVal !== null && macVal !== undefined) {
        if (!Array.isArray(fmFlow[step])) fmFlow[step] = [];
        while (fmFlow[step].length <= alt) fmFlow[step].push(null);
        fmFlow[step][alt] = macVal;
      }

      if (!Array.isArray(ctFlow[step])) ctFlow[step] = [];
      while (ctFlow[step].length <= alt) ctFlow[step].push(null);
      ctFlow[step][alt] = ctVal;

      if (!Array.isArray(stFlow[step])) stFlow[step] = [];
      while (stFlow[step].length <= alt) stFlow[step].push(null);
      stFlow[step][alt] = stDict;
    }
  }

  return { fixedMachine: fmOut, cycleTime: ctOut, setupConfig: stOut };
}

module.exports = { getValueStrict, processRouting, processUnifiedMachineConfig };
