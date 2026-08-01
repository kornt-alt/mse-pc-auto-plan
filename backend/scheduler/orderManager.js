// Port 1:1 จาก OLD_BACKUP\backend\scheduler_core.py L145-255 (class OrderManager)
// pure — ห้าม import DB / clock; วันที่เป็น string 'YYYY-MM-DD' เทียบ lexicographic
'use strict';

const { ENABLE_PACKING, PACK_WINDOW_DAYS, SENTINEL_DEFAULT_DUE } = require('../config/constants');
const { diffDays } = require('../utils/dates');
const { pyFloat } = require('./pyUtils');

class OrderManager {
  // ฟีเจอร์ Mat'l/Confirm: รับ settings object (จากตาราง system_settings) — pack_window_days
  // มาจากตรงนี้แทน constant (fallback เป็น PACK_WINDOW_DAYS ถ้าไม่มี) ตรง scheduler_core.py
  constructor(enablePacking = ENABLE_PACKING, settings = null) {
    this.enablePacking = enablePacking;
    const s = settings || {};
    this.packWindowDays = s.pack_window_days != null ? s.pack_window_days : PACK_WINDOW_DAYS;
    this.finalOrders = [];
    // Map เพื่อคง insertion order — batch id เป็นเลขล้วน JS object จะ reorder คีย์เอง
    this.statusMap = new Map();
  }

  // process_orders (L152-166)
  processOrders(rawOrders) {
    const cleanedOrders = rawOrders.map((o) => this.parseRawInput(o));
    const packedOrders = this.enablePacking ? this.packOrders(cleanedOrders) : cleanedOrders;
    const finalList = this.sortForScheduler(packedOrders);

    this.finalOrders = finalList;
    for (const o of finalList) {
      this.statusMap.set(o.Batch, o); // เก็บ reference เดิม — engine จะ mutate ทีหลัง
    }
    return [this.finalOrders, this.statusMap];
  }

  // parse_raw_input (L168-196) — defaults ตรง Python ทุกตัว
  parseRawInput(o) {
    const clean = {
      Batch: String(o.Batch || o.batch || 'Unknown'),
    };

    if ('qty' in o) clean.qty = pyFloat(o.qty);
    else if ('Qty' in o) clean.qty = pyFloat(o.Qty);
    else clean.qty = 0;

    clean.Model = String(o.Model || o.model || 'UNKNOWN').trim();
    clean.setup_group = String(o.setup_group || clean.Model).trim().toUpperCase();

    // Confirm/VIP: ถ้ามี confirm_reply_date ให้สวมรอยเป็น dueDate เลย (scheduler_core.py L263-270)
    const confDate = 'confirm_reply_date' in o ? o.confirm_reply_date : '';
    clean.dueDate = confDate ? confDate : ('dueDate' in o ? o.dueDate : SENTINEL_DEFAULT_DUE);

    clean.priority = pyFloat('priority' in o ? o.priority : 99);
    clean.releaseDate = 'releaseDate' in o ? o.releaseDate : null;
    // Mat'l: วันพร้อมเริ่มจริง (max ของ release/material — คำนวณใน planBuilder)
    clean.effectiveReadyDate = 'effectiveReadyDate' in o ? o.effectiveReadyDate : '1970-01-01';
    clean.planningMode = 'planningMode' in o ? o.planningMode : 'forward';
    clean.PlanMode = String(o.planMode || o.PlanMode || 'NEW').toUpperCase();
    clean.WIP_FlowIndex = 'WIP_FlowIndex' in o ? o.WIP_FlowIndex : null;
    clean.WIP_StartStepIndex = pyFloat('WIP_StartStepIndex' in o ? o.WIP_StartStepIndex : 0);
    clean.WIP_Machine = 'WIP_Machine' in o ? o.WIP_Machine : null;
    clean.WIP_FinishDate = 'WIP_FinishDate' in o ? o.WIP_FinishDate : null;

    // ประทับตราส่งไปตอน pack/sort (scheduler_core.py L285-288)
    clean.confirm_reply_date = confDate;
    clean.is_vip = Boolean(confDate);
    clean.has_actuals = 'has_actuals' in o ? o.has_actuals : false;

    if ('OriginalOrders' in o) {
      clean.original_batches = o.OriginalOrders.map((sub) => ({
        batch: sub.Batch,
        qty: 'qty' in sub ? sub.qty : 0,
      }));
    } else if ('original_batches' in o) {
      clean.original_batches = o.original_batches;
    } else {
      clean.original_batches = [];
    }

    return clean;
  }

  // pack_orders (L198-239): จับกลุ่มตาม SETUP|FLOW|STEP|MODE แล้ว greedy merge
  // ตาม dueDate gap ≤ packWindowDays — Map เพื่อคง insertion order ของกลุ่มแบบ Python dict
  packOrders(orders) {
    const groups = new Map(); // defaultdict(list)
    for (const o of orders) {
      const setupKey = o.setup_group;
      const stepKey = o.WIP_StartStepIndex;
      const flowKey =
        stepKey > 0 && o.WIP_FlowIndex !== null && o.WIP_FlowIndex !== undefined
          ? o.WIP_FlowIndex
          : 'NEW';
      const modeKey = String(o.planningMode).toUpperCase();
      // Mat'l: วันพร้อมต่างกันแยกถุง (scheduler_core.py L316)
      const effDateKey = String(o.effectiveReadyDate ?? '1970-01-01');
      // VIP: มี confirm date → มัดเฉพาะ confirm วันเดียวกัน (L318-321)
      const isVip = o.is_vip ?? false;
      const confDate = o.confirm_reply_date ?? '';
      const vipTag = isVip ? `VIP:${confDate}` : 'NORMAL';
      // Actual: batch ที่ผลิตไปแล้วบังคับฉายเดี่ยว (L323-326)
      const hasActuals = o.has_actuals ?? false;
      const actualsTag = hasActuals ? `|ACTUAL:${o.Batch}` : '';

      const groupKey = `SETUP:${setupKey}|FLOW:${flowKey}|STEP:${stepKey}|MODE:${modeKey}|EFF_DATE:${effDateKey}|CLASS:${vipTag}${actualsTag}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(o);
    }

    const packedResult = [];

    for (const groupOrders of groups.values()) {
      // Python sort ด้วย strptime — เทียบ string ให้ผลเรียงเหมือนกันสำหรับ YYYY-MM-DD
      groupOrders.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
      let currentPack = null;

      for (const order of groupOrders) {
        if (!currentPack) {
          currentPack = structuredClone(order);
          currentPack.original_batches = [{ batch: order.Batch, qty: order.qty }];
        } else {
          const dateDiff = diffDays(currentPack.dueDate, order.dueDate);

          if (dateDiff <= this.packWindowDays) {
            currentPack.qty += order.qty;
            currentPack.original_batches.push({ batch: order.Batch, qty: order.qty });
            if (order.dueDate > currentPack.dueDate) currentPack.dueDate = order.dueDate;
          } else {
            this._pushPack(currentPack, packedResult);
            currentPack = structuredClone(order);
            currentPack.original_batches = [{ batch: order.Batch, qty: order.qty }];
          }
        }
      }

      if (currentPack) this._pushPack(currentPack, packedResult);
    }

    return packedResult;
  }

  // _push_pack (L241-247)
  _pushPack(pack, targetList) {
    if (pack.original_batches.length > 1) {
      if (!pack.Batch.startsWith('PACK-')) {
        const safeDate = pack.dueDate.replace(/-/g, '');
        pack.Batch = `PACK-${pack.setup_group}-${safeDate}`;
      }
    }
    targetList.push(pack);
  }

  // sort_for_scheduler (L390-402): VIP ขึ้นก่อน แล้วค่อย (priority, dueDate) — stable
  sortForScheduler(orders) {
    orders.sort((a, b) => {
      const va = a.is_vip ? 0 : 1;
      const vb = b.is_vip ? 0 : 1;
      if (va !== vb) return va - vb;
      const pa = a.priority ?? 99;
      const pb = b.priority ?? 99;
      if (pa !== pb) return pa < pb ? -1 : 1;
      const da = a.dueDate ?? SENTINEL_DEFAULT_DUE;
      const db = b.dueDate ?? SENTINEL_DEFAULT_DUE;
      return da < db ? -1 : da > db ? 1 : 0;
    });
    return orders;
  }
}

module.exports = { OrderManager };
