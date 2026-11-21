import './style.css';
import seedData from './seedData.json';
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot, type Firestore } from 'firebase/firestore';

// --- Types ---
export interface Member {
  id: string;
  name: string;
  roomType: 'single' | 'medium' | 'shared';
  roomLabel: string;
  baseRent: number;
  phone?: string;
}

export interface LandlordPayment {
  id: string;
  amount: number;
  date: string;
  method: string;
  note?: string;
}

export interface LandlordPackage {
  rent: number;        // 19000
  gas: number;         // 1080
  lift: number;        // 1400 (200/person)
  water: number;       // 1400 (200/person)
  electricity: number; // 2000 (or meter units * rate)
  previousDue: number; // carried over unpaid landlord balance from previous month
  previousDueMention?: string;
  payments: LandlordPayment[];
}

export interface IndependentBill {
  id: string;
  title: string;
  icon: string;
  amount: number;
  isPaid: boolean;
  paidDate?: string;
  paidMethod?: string;
  paidNote?: string;
}

export interface CommonExpense {
  id: string;
  title: string;
  amount: number;
  paidBy: string; // 'flat' or member id
  date: string;
  method?: string;
}

export interface Payment {
  id: string;
  memberId: string;
  amount: number;
  date: string;
  method: string;
  note?: string;
}

export interface MemberMonthRecord {
  memberId: string;
  previousBalance: number; // negative = due from last month, positive = advance
  previousBalanceMention?: string; // detailed note of carryover
  payments: Payment[];
}

export interface MonthData {
  id: string;
  name: string;
  landlord: LandlordPackage;
  otherBills: Record<string, IndependentBill>;
  electricityUnits: number;
  baselineUnits: number;
  unitRate: number;
  commonExpenses: CommonExpense[];
  memberRecords: Record<string, MemberMonthRecord>;
  isClosed?: boolean;
}

export interface FirebaseConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

export interface AppState {
  members: Member[];
  currentMonthId: string;
  activePage: 'side1' | 'side2';
  side1ViewMode?: 'dual' | 'table' | 'cards';
  months: MonthData[];
  paymentSettings: {
    bkashNumber: string;
    nagadNumber: string;
  };
  googleSheetsSettings?: {
    webhookUrl?: string;
    lastSyncedAt?: string;
  };
  firebaseConfig?: FirebaseConfig;
}

// --- Standard Constants & UI Utilities ---
const STANDARD_BASE_TOTAL = 26880;

export function getMemberAvatar(member: Member): { initials: string; gradient: string } {
  const parts = member.name.trim().split(/\s+/);
  const initials = parts.length > 1 
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : member.name.substring(0, 2).toUpperCase();
  
  let gradient = 'from-indigo-500 via-indigo-600 to-violet-600';
  if (member.roomType === 'medium') {
    gradient = 'from-sky-500 to-cyan-600';
  } else if (member.roomType === 'shared') {
    gradient = member.name.toLowerCase().includes('turag') 
      ? 'from-emerald-500 to-teal-600' 
      : 'from-amber-500 to-orange-600';
  }
  return { initials, gradient };
}

export function showToast(message: string, icon = '✓') {
  let toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.className = 'fixed top-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-900/95 text-white text-xs font-bold border border-white/15 shadow-[0_16px_40px_rgba(0,0,0,0.7)] backdrop-blur-xl animate-toast transition-all duration-300';
  toast.innerHTML = `<span class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-400/30 flex items-center justify-center text-[10px] font-black">${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

const DEFAULT_MEMBERS: Member[] = [
  { id: 'sowpnil', name: 'Sowpnil', roomType: 'single', roomLabel: 'Single / Master Room', baseRent: 4050 },
  { id: 'miraj', name: 'Miraj', roomType: 'single', roomLabel: 'Single / Master Room', baseRent: 4050 },
  { id: 'ashik', name: 'Ashik', roomType: 'single', roomLabel: 'Single / Master Room', baseRent: 4050 },
  { id: 'khaled', name: 'Khaled', roomType: 'single', roomLabel: 'Single / Master Room', baseRent: 4050 },
  { id: 'kanchon', name: 'Kanchon', roomType: 'medium', roomLabel: 'Medium Room', baseRent: 3700 },
  { id: 'rafi', name: 'Rafi', roomType: 'shared', roomLabel: 'Shared Room', baseRent: 3300 },
  { id: 'turag', name: 'Turag', roomType: 'shared', roomLabel: 'Shared Room', baseRent: 3300 }
];

export function createDefaultLandlord(elecUnits = 160, unitRate = 10): LandlordPackage {
  const unitsDiff = elecUnits - 160;
  const elecAmount = 2000 + (unitsDiff * unitRate);

  return {
    rent: 19000,
    gas: 1080,
    lift: 1400,
    water: 1400,
    electricity: elecAmount,
    previousDue: 0,
    payments: []
  };
}

export function createDefaultOtherBills(): Record<string, IndependentBill> {
  return {
    wifi: { id: 'wifi', title: 'Wi-Fi Bill', icon: '📶', amount: 800, isPaid: false },
    cleaning: { id: 'cleaning', title: 'Cleaning Lady (Khala/Bua)', icon: '🧹', amount: 1000, isPaid: false },
    moyla: { id: 'moyla', title: 'Moyla (Garbage)', icon: '🗑️', amount: 200, isPaid: false }
  };
}

// --- Initialize State ---
function initializeState(): AppState {
  const saved = localStorage.getItem('basa_vara_hisab_state_v6');
  if (saved) {
    try {
      const parsed: AppState = JSON.parse(saved);
      // Ensure Khaled's payment is logged for November 2026 if empty
      const nov = parsed.months?.find(m => m.id === 'november-2026');
      if (nov && nov.memberRecords?.khaled) {
        const khaledRec = nov.memberRecords.khaled;
        if (!khaledRec.payments || khaledRec.payments.length === 0) {
          khaledRec.payments = [{
            id: 'init-khaled',
            memberId: 'khaled',
            amount: 4295,
            date: '2026-11-21',
            method: 'Cash',
            note: 'Full November Bill Paid'
          }];
        }
      }
      return parsed;
    } catch (e) {
      console.error('Failed to parse local storage, resetting to default', e);
    }
  }

  const months: MonthData[] = [];

  // Seed history from Excel
  if (seedData && seedData.history) {
    for (const h of seedData.history) {
      const records: Record<string, MemberMonthRecord> = {};
      for (const m of DEFAULT_MEMBERS) {
        const rawRec = (h.records as Record<string, any>)?.[m.id];
        const prevBal = rawRec ? (rawRec.thisMonth - rawRec.haveToPay) : 0;
        const paidVal = rawRec ? rawRec.paid : 0;
        
        records[m.id] = {
          memberId: m.id,
          previousBalance: prevBal,
          previousBalanceMention: prevBal < 0 ? `Unpaid Due: ${Math.abs(prevBal)} ৳ from previous month` : prevBal > 0 ? `Advance Credit: ${prevBal} ৳` : undefined,
          payments: paidVal > 0 ? [{
            id: 'init-' + m.id,
            memberId: m.id,
            amount: paidVal,
            date: '2026-11-01',
            method: 'Cash',
            note: 'Logged in Cash'
          }] : []
        };
      }

      // November 2026 has +245 ৳ living bill adjustment per member (+1715 ৳ total / 331.5 units) to match Google Sheet exactly
      const elecUnits = (h.id === 'november-2026') ? 331.5 : 160;
      months.push({
        id: h.id,
        name: h.name,
        landlord: createDefaultLandlord(elecUnits, 10),
        otherBills: createDefaultOtherBills(),
        electricityUnits: elecUnits,
        baselineUnits: 160,
        unitRate: 10,
        commonExpenses: [],
        memberRecords: records,
        isClosed: true
      });
    }
  }

  // Active Month (November 2026)
  let currentMonth = months.find(m => m.id === 'november-2026');
  if (!currentMonth) {
    const defaultRecords: Record<string, MemberMonthRecord> = {};
    const octMonth = months.find(m => m.id === 'october-2026');
    for (const m of DEFAULT_MEMBERS) {
      let prevBal = 0;
      let mention = '';
      if (octMonth && octMonth.memberRecords[m.id]) {
        const rawRec = (seedData.history as any)?.find((x: any) => x.id === 'october-2026')?.records?.[m.id];
        if (rawRec && rawRec.remaining !== undefined) {
          prevBal = rawRec.remaining;
          if (prevBal < 0) {
            mention = `Due: ${Math.abs(prevBal)} ৳ from October (Billed ${rawRec.haveToPay || 0} ৳, Paid ${rawRec.paid || 0} ৳)`;
          } else if (prevBal > 0) {
            mention = `Advance: ${prevBal} ৳ from October`;
          }
        }
      }
      defaultRecords[m.id] = {
        memberId: m.id,
        previousBalance: prevBal,
        previousBalanceMention: mention || undefined,
        payments: []
      };
    }

    currentMonth = {
      id: 'november-2026',
      name: 'November 2026',
      landlord: createDefaultLandlord(331.5, 10),
      otherBills: createDefaultOtherBills(),
      electricityUnits: 331.5,
      baselineUnits: 160,
      unitRate: 10,
      commonExpenses: [],
      memberRecords: defaultRecords,
      isClosed: false
    };
    months.push(currentMonth);
  } else {
    currentMonth.isClosed = false;
    currentMonth.electricityUnits = 331.5;
    currentMonth.landlord = createDefaultLandlord(331.5, 10);
    if (!currentMonth.otherBills) currentMonth.otherBills = createDefaultOtherBills();
  }

  return {
    members: DEFAULT_MEMBERS,
    currentMonthId: 'november-2026',
    activePage: 'side1',
    side1ViewMode: 'dual',
    months: months,
    paymentSettings: {
      bkashNumber: '017XXXXXXXX',
      nagadNumber: '018XXXXXXXX'
    }
  };
}

let state: AppState = initializeState();

let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;
let isApplyingCloudSnapshot = false;

export function setupFirebase(config: FirebaseConfig): boolean {
  try {
    if (!getApps().length) {
      firebaseApp = initializeApp(config);
    } else {
      firebaseApp = getApps()[0];
    }
    firestoreDb = getFirestore(firebaseApp);

    // Listen to real-time changes across devices
    onSnapshot(doc(firestoreDb, 'hisab_app', 'current_state'), (docSnap) => {
      if (docSnap.exists()) {
        const cloudData = docSnap.data() as AppState;
        if (cloudData && cloudData.months && Array.isArray(cloudData.months)) {
          const cloudStr = JSON.stringify(cloudData);
          const localStr = JSON.stringify(state);
          if (cloudStr !== localStr) {
            isApplyingCloudSnapshot = true;
            state = cloudData;
            localStorage.setItem('basa_vara_hisab_state_v6', cloudStr);
            render();
            isApplyingCloudSnapshot = false;
            showToast('Live update synced from Firebase Cloud!', '☁️');
          }
        }
      }
    });

    const badge = document.getElementById('cloudSyncBadge');
    if (badge) {
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span><span>Firebase Live</span>`;
      badge.className = 'text-[10px] font-bold text-sky-400 bg-sky-950/60 border border-sky-500/30 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-[0_0_12px_rgba(56,189,248,0.2)] cursor-pointer';
    }
    return true;
  } catch (err: any) {
    console.error('Firebase setup failed:', err);
    return false;
  }
}

if (state.firebaseConfig) {
  setupFirebase(state.firebaseConfig);
}

export function saveState() {
  const json = JSON.stringify(state);
  localStorage.setItem('basa_vara_hisab_state_v6', json);

  // Auto-save to PC Hard Drive (F:\Hisab\hisab-data.json)
  fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json
  }).then(r => r.json()).then(() => {
    const badge = document.getElementById('diskSyncBadge');
    if (badge) {
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span><span>PC Disk Synced</span>`;
      badge.className = 'text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.2)] cursor-pointer';
    }
  }).catch(() => {
    // Offline or static preview mode
  });

  // Real-time Cloud Save to Firebase Firestore (Multi-Device Auto-Sync)
  if (firestoreDb && !isApplyingCloudSnapshot) {
    const cleanObj = JSON.parse(json);
    setDoc(doc(firestoreDb, 'hisab_app', 'current_state'), cleanObj)
      .then(() => {
        const badge = document.getElementById('cloudSyncBadge');
        if (badge) {
          badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span><span>Firebase Live</span>`;
          badge.className = 'text-[10px] font-bold text-sky-400 bg-sky-950/60 border border-sky-500/30 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-[0_0_12px_rgba(56,189,248,0.2)] cursor-pointer';
        }
      })
      .catch((err) => console.warn('Firestore write warning:', err));
  }
}

// Auto-load state from PC disk on boot
async function syncFromDiskOnBoot() {
  try {
    const res = await fetch('/api/data');
    if (res.ok) {
      const diskData = await res.json();
      if (diskData && diskData.months && Array.isArray(diskData.months) && diskData.months.length > 0) {
        state = diskData;
        localStorage.setItem('basa_vara_hisab_state_v6', JSON.stringify(state));
        render();
        console.log('✓ Loaded state from PC hard drive (hisab-data.json)');
        return;
      }
    } else if (res.status === 404) {
      saveState();
    }
  } catch (err) {
    console.warn('Vite disk API offline, running from browser cache', err);
  }
}

// --- Unified Calculation Engine with Strict Distinct Separation ---
export function calculateMonth(month: MonthData, members: Member[]) {
  const memberCount = members.length || 7;

  if (!month.landlord) month.landlord = createDefaultLandlord(month.electricityUnits || 160, month.unitRate || 10);
  if (!month.landlord.payments) month.landlord.payments = [];
  if (!month.otherBills) month.otherBills = createDefaultOtherBills();

  const l = month.landlord;

  // 1. DISTINCT This Month Landlord Bill (Pure living cost for this month)
  const landlordDistinctMonth = l.rent + l.gas + l.lift + l.water + l.electricity;

  // Landlord Arrears & Cumulative Payable
  const landlordPrevDue = l.previousDue || 0;
  const landlordTotalPayable = landlordDistinctMonth + landlordPrevDue;

  // Landlord Installments Paid
  const landlordTotalPaid = l.payments.reduce((sum, p) => sum + p.amount, 0);
  const landlordRemainingDue = landlordTotalPayable - landlordTotalPaid;
  const isLandlordCleared = landlordRemainingDue <= 0;

  // 2. Other Bills (Distinct Month)
  let otherBillsDistinctMonth = 0;
  let otherBillsPaid = 0;
  let otherBillsRemaining = 0;

  Object.values(month.otherBills).forEach(b => {
    otherBillsDistinctMonth += b.amount;
    if (b.isPaid) {
      otherBillsPaid += b.amount;
    } else {
      otherBillsRemaining += b.amount;
    }
  });

  // 3. Common Expenses (Distinct Month)
  let totalExpenses = 0;
  let totalExpensesPaid = 0;
  const outOfPocketCredits: Record<string, number> = {};
  members.forEach(m => { outOfPocketCredits[m.id] = 0; });

  for (const exp of month.commonExpenses) {
    totalExpenses += exp.amount;
    totalExpensesPaid += exp.amount;
    if (exp.paidBy && exp.paidBy !== 'flat') {
      outOfPocketCredits[exp.paidBy] = (outOfPocketCredits[exp.paidBy] || 0) + exp.amount;
    }
  }

  // --- GRAND TOTALS FOR THIS MONTH (DISTINCT) ---
  const grandDistinctMonthBills = landlordDistinctMonth + otherBillsDistinctMonth + totalExpenses;
  const grandCumulativeBills = landlordTotalPayable + otherBillsDistinctMonth + totalExpenses;
  const grandBillsPaid = landlordTotalPaid + otherBillsPaid + totalExpensesPaid;
  const grandBillsRemaining = (landlordRemainingDue > 0 ? landlordRemainingDue : 0) + otherBillsRemaining;

  // 4. Dynamic Delta Distribution for Roommates (Calculated purely from DISTINCT monthly costs)
  const deltaFromBase = grandDistinctMonthBills - STANDARD_BASE_TOTAL;
  const perPersonDelta = Math.round((deltaFromBase / memberCount) * 100) / 100;

  // Electricity stats for quick reference
  const unitsDiff = (month.electricityUnits || 160) - (month.baselineUnits || 160);
  const totalElecAdj = unitsDiff * (month.unitRate || 10);
  const elecAdjPerPerson = Math.round((totalElecAdj / memberCount) * 100) / 100;

  // 5. Roommate Calculations (DISTINCT This Month vs Cumulative Have To Pay)
  let totalBaseRent = 0;
  let totalDistinctMemberBills = 0;
  let totalMemberPayable = 0;
  let totalCashCollected = 0;
  let totalMemberDueRemaining = 0;

  const rows = members.map(m => {
    const rec = month.memberRecords[m.id] || {
      memberId: m.id,
      previousBalance: 0,
      payments: []
    };

    totalBaseRent += m.baseRent;

    // DISTINCT This Month Charge (Pure monthly living cost!)
    const distinctThisMonth = Math.round(m.baseRent + perPersonDelta);
    totalDistinctMemberBills += distinctThisMonth;

    // Have To Pay = Distinct This Month - Previous Balance (negative prevBalance means due, so it adds)
    const prevBal = rec.previousBalance || 0;
    const haveToPay = Math.round(distinctThisMonth - prevBal);

    // Direct Cash Payments + Out of pocket credits
    const directCashPaid = rec.payments.reduce((sum, p) => sum + p.amount, 0);
    const expenseCredit = outOfPocketCredits[m.id] || 0;
    const totalPaid = directCashPaid + expenseCredit;

    // Remaining = Total Paid - Have To Pay
    const remaining = totalPaid - haveToPay;

    totalMemberPayable += haveToPay;
    totalCashCollected += directCashPaid;
    if (remaining < 0) {
      totalMemberDueRemaining += Math.abs(remaining);
    }

    return {
      member: m,
      baseRent: m.baseRent,
      perPersonDelta,
      distinctThisMonth, // ⭐ STRICTLY DISTINCT FOR THIS MONTH
      prevBal,
      mention: rec.previousBalanceMention,
      haveToPay,         // ⭐ CUMULATIVE AMOUNT OWED
      directCashPaid,
      expenseCredit,
      totalPaid,
      remaining,
      payments: rec.payments
    };
  });

  // 6. Cash in Hand (Mess Wallet)
  const cashInHand = totalCashCollected - grandBillsPaid;

  return {
    landlordDistinctMonth,
    landlordPrevDue,
    landlordTotalPayable,
    landlordTotalPaid,
    landlordRemainingDue,
    isLandlordCleared,
    otherBillsDistinctMonth,
    otherBillsPaid,
    otherBillsRemaining,
    grandDistinctMonthBills,
    grandCumulativeBills,
    grandBillsPaid,
    grandBillsRemaining,
    deltaFromBase,
    perPersonDelta,
    unitsDiff,
    totalElecAdj,
    elecAdjPerPerson,
    totalBaseRent,
    totalDistinctMemberBills,
    totalMemberPayable,
    totalCashCollected,
    totalMemberDueRemaining,
    cashInHand,
    rows
  };
}

// --- Render UI ---
function render() {
  const activeEl = document.activeElement as HTMLInputElement | null;
  const activeId = activeEl ? activeEl.id : null;
  const cursorPos = activeEl && activeEl.selectionStart !== null ? activeEl.selectionStart : null;

  const app = document.getElementById('app');
  if (!app) return;

  const currentMonth = state.months.find(m => m.id === state.currentMonthId) || state.months[state.months.length - 1];
  const calc = calculateMonth(currentMonth, state.members);

  const percentBillsPaid = calc.grandCumulativeBills > 0 
    ? Math.min(100, Math.round((calc.grandBillsPaid / calc.grandCumulativeBills) * 100)) 
    : 0;

  const percentRoommatesPaid = calc.totalMemberPayable > 0 
    ? Math.min(100, Math.round((calc.totalCashCollected / calc.totalMemberPayable) * 100)) 
    : 0;

  const l = currentMonth.landlord;
  const isSide1 = state.activePage === 'side1';

  app.innerHTML = `
    <!-- FLOATING GLASS ISLAND HEADER (Bencho & Apple-style Segmented Design) -->
    <header class="sticky top-3 z-40 max-w-7xl mx-auto px-3 sm:px-6 mb-6">
      <div class="glass-panel px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 border border-white/10 shadow-[0_16px_50px_rgba(0,0,0,0.6)] rounded-3xl">
        
        <!-- Brand & Title -->
        <div class="flex items-center gap-3.5">
          <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 via-indigo-600 to-violet-600 flex items-center justify-center text-white font-extrabold text-xl shadow-[0_0_24px_rgba(99,102,241,0.5)] ring-1 ring-white/20">
            🏠
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-lg font-black text-white tracking-tight">Basa Vara & Mess Hisab</h1>
              <span class="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${isSide1 ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shadow-[0_0_12px_rgba(99,102,241,0.2)]' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]'}">
                ${isSide1 ? 'Side 1: Roommates' : 'Side 2: Landlord & Bills'}
              </span>
            </div>
            <p class="text-[11px] text-slate-400 font-medium">Strictly Distinct Living Bills • Multi-Installments • Physical Mess Drawer</p>
          </div>
        </div>

        <!-- BENCHO-STYLE SEGMENTED PILL SWITCHER -->
        <div class="flex items-center p-1 bg-slate-950/80 backdrop-blur-md rounded-2xl border border-white/10 shadow-inner">
          <button id="tabSide1" class="px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all duration-300 cursor-pointer ${isSide1 ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-[0_0_20px_rgba(99,102,241,0.5)]' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'}">
            <span>📋</span>
            <span>Roommate Collections</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${isSide1 ? 'bg-indigo-950/80 text-indigo-200 border border-indigo-400/30' : 'bg-slate-900/80 text-slate-400 border border-white/5'}">
              ${calc.totalMemberDueRemaining > 0 ? `${calc.totalMemberDueRemaining.toLocaleString()} ৳ due` : 'Cleared ✓'}
            </span>
          </button>

          <button id="tabSide2" class="px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all duration-300 cursor-pointer ${!isSide1 ? 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-[0_0_20px_rgba(16,185,129,0.5)]' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'}">
            <span>🏠</span>
            <span>Flat Bills & Landlord</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${!isSide1 ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-400/30' : 'bg-slate-900/80 text-slate-400 border border-white/5'}">
              ${calc.grandBillsRemaining > 0 ? `${calc.grandBillsRemaining.toLocaleString()} ৳ unpaid` : 'Cleared ✓'}
            </span>
          </button>
        </div>

        <!-- Actions & Mess Wallet Badge -->
        <div class="flex items-center gap-2.5 flex-wrap">
          
          <!-- Glowing Mess Drawer Badge with Interactive Tooltip -->
          <div class="has-tooltip flex items-center gap-2 text-xs font-black px-3.5 py-2 rounded-2xl border backdrop-blur-md cursor-help ${calc.cashInHand >= 0 ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : 'bg-rose-950/40 border-rose-500/30 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.2)]'}">
            <span class="w-2 h-2 rounded-full ${calc.cashInHand >= 0 ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)] animate-pulse'}"></span>
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mess Drawer:</span>
            <span class="text-sm tabular-nums font-black">${calc.cashInHand >= 0 ? '+' : ''}${calc.cashInHand.toLocaleString()} ৳</span>

            <!-- Tooltip Popup -->
            <div class="tooltip-content p-3.5 rounded-2xl bg-slate-900/98 border border-white/15 text-slate-300 text-xs shadow-2xl space-y-1.5 font-normal">
              <div class="font-black text-white text-xs border-b border-white/10 pb-1 flex items-center justify-between">
                <span>💵 Mess Drawer Balance</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">Cash Flow</span>
              </div>
              <div class="text-[11px] flex justify-between">
                <span class="text-slate-400">Cash Collected (In):</span>
                <strong class="text-indigo-300 tabular-nums">+${calc.totalCashCollected.toLocaleString()} ৳</strong>
              </div>
              <div class="text-[11px] flex justify-between">
                <span class="text-slate-400">Bills Paid Out (Out):</span>
                <strong class="text-rose-400 tabular-nums">-${calc.grandBillsPaid.toLocaleString()} ৳</strong>
              </div>
              <div class="border-t border-white/10 pt-1 text-xs font-black flex justify-between ${calc.cashInHand >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                <span>${calc.cashInHand >= 0 ? 'Cash in Hand:' : 'Personal Deficit:'}</span>
                <span class="tabular-nums">${calc.cashInHand >= 0 ? '+' : ''}${calc.cashInHand.toLocaleString()} ৳</span>
              </div>
              <div class="text-[10px] text-slate-400 pt-0.5 leading-tight">
                ${calc.cashInHand < 0 
                  ? `Out-of-pocket deficit. Fully reimbursed as remaining ${calc.totalMemberDueRemaining.toLocaleString()} ৳ dues are collected.` 
                  : 'Physical cash available in mess drawer.'}
              </div>
            </div>
          </div>

          <!-- Month Selector -->
          <div class="relative inline-block text-left">
            <select id="monthSelect" class="bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-xs font-extrabold rounded-xl pl-3 pr-7 py-2 border border-white/10 shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer transition">
              ${state.months.map(m => `
                <option value="${m.id}" ${m.id === currentMonth.id ? 'selected' : ''}>
                  📅 ${m.name} ${m.id === currentMonth.id ? '(Active)' : ''}
                </option>
              `).join('')}
            </select>
          </div>

          <button id="btnNewMonth" class="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-extrabold px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-[0_0_20px_rgba(99,102,241,0.35)] transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer">
            <span>✨</span> Next Month
          </button>

          <button id="btnCopyWhatsApp" class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-extrabold px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-[0_0_20px_rgba(16,185,129,0.35)] transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer" title="Copy WhatsApp message">
            <span>📱</span> WhatsApp
          </button>

          <!-- PC Hard Drive Sync Indicator -->
          <div id="diskSyncBadge" class="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.2)] cursor-pointer" title="Auto-saving to F:\Hisab\hisab-data.json (Click to open Sync Center)">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>PC Disk Synced</span>
          </div>

          <!-- Firebase Real-Time Cloud Badge -->
          <div id="cloudSyncBadge" class="text-[10px] font-bold ${state.firebaseConfig ? 'text-sky-400 bg-sky-950/60 border-sky-500/30 shadow-[0_0_12px_rgba(56,189,248,0.2)]' : 'text-slate-400 bg-slate-900/60 border-white/10'} border px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer" title="Firebase Multi-Device Real-Time Sync (Click to configure)">
            <span class="w-1.5 h-1.5 rounded-full ${state.firebaseConfig ? 'bg-sky-400 animate-pulse' : 'bg-slate-500'}"></span>
            <span>${state.firebaseConfig ? 'Firebase Live' : 'Connect Cloud'}</span>
          </div>

          <!-- Cloud & Backup Button -->
          <button id="btnOpenSyncModal" class="bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl border border-white/10 shadow-xs flex items-center gap-1.5 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer" title="Auto-save to PC & Google Sheets Sync">
            <span>💾</span> Sync & Backup
          </button>

          <button id="btnSettings" class="bg-slate-900/80 hover:bg-slate-800 text-slate-300 text-xs font-bold px-2.5 py-2 rounded-xl border border-white/10 shadow-xs transition cursor-pointer" title="Settings">
            ⚙️
          </button>
        </div>

      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 pb-12">

      ${isSide1 ? renderSide1(currentMonth, calc, percentRoommatesPaid) : renderSide2(currentMonth, calc, percentBillsPaid, l)}

      <!-- CHRONOLOGICAL ACTIVITY LOG (Visible on both pages) -->
      <div class="glass-panel p-6 border border-white/10 shadow-[0_16px_50px_rgba(0,0,0,0.6)] rounded-3xl">
        <div class="flex items-center justify-between pb-3.5 border-b border-white/10">
          <div>
            <h3 class="text-sm font-black text-white flex items-center gap-2">
              <span>📅</span> Chronological Cash Activity Log
            </h3>
            <p class="text-xs text-slate-400 font-medium">Every cash collection from roommates and bill payout to Landlord / vendors recorded by date.</p>
          </div>
          <span class="text-xs font-bold px-3 py-1 rounded-xl bg-slate-900/80 border border-white/10 text-slate-300 shadow-xs">
            ${currentMonth.name}
          </span>
        </div>

        <div class="mt-4 space-y-2.5 max-h-64 overflow-y-auto pr-1">
          ${renderActivityLog(currentMonth)}
        </div>
      </div>

    </main>

    <!-- Modal Container with Deep Backdrop Blur -->
    <div id="modalOverlay" class="fixed inset-0 bg-black/75 backdrop-blur-xl z-50 hidden flex items-center justify-center p-4">
      <div id="modalContent" class="glass-modal max-w-lg w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
        <!-- Injected dynamically -->
      </div>
    </div>
  `;

  attachEventListeners();

  if (activeId) {
    const newEl = document.getElementById(activeId) as HTMLInputElement | null;
    if (newEl) {
      newEl.focus();
      if (cursorPos !== null) {
        try { newEl.setSelectionRange(cursorPos, cursorPos); } catch (_) {}
      }
    }
  }
}

// --- PAGE 1: SIDE 1 (Roommate Collections - Cash In) ---
function renderSide1(currentMonth: MonthData, calc: ReturnType<typeof calculateMonth>, percentRoommatesPaid: number) {
  const viewMode = state.side1ViewMode || 'dual';

  return `
    <!-- Side 1 Bento Stat Tiles -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      
      <!-- Total Collection Needed -->
      <div class="has-tooltip glass-panel p-5 border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.5)] rounded-3xl relative overflow-hidden cursor-help">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Collection Needed</span>
          <div class="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-center text-sm shadow-[0_0_12px_rgba(245,158,11,0.2)]">
            💰
          </div>
        </div>
        <div class="mt-2.5 flex items-baseline gap-2">
          <span class="text-3xl font-black tabular-nums tracking-tight text-white">${calc.totalMemberPayable.toLocaleString()}</span>
          <span class="text-xs font-bold text-slate-400">BDT</span>
        </div>
        <p class="text-[11px] text-slate-400 font-semibold mt-1.5 flex items-center gap-1.5">
          <span>Distinct: <strong class="text-indigo-300">${calc.totalDistinctMemberBills.toLocaleString()} ৳</strong></span>
          <span class="text-slate-600">•</span>
          <span>Past Due: <strong class="text-rose-300">${(calc.totalMemberPayable - calc.totalDistinctMemberBills).toLocaleString()} ৳</strong></span>
        </p>

        <!-- Tooltip -->
        <div class="tooltip-content p-3 rounded-2xl bg-slate-900 border border-white/15 text-slate-300 text-xs shadow-2xl space-y-1 font-normal">
          <div class="font-black text-white text-xs border-b border-white/10 pb-1">💰 Total Roommate Payable</div>
          <div>This Month Distinct: <strong class="text-indigo-300">+${calc.totalDistinctMemberBills.toLocaleString()} ৳</strong></div>
          <div>Past Months' Dues: <strong class="text-rose-300">+${(calc.totalMemberPayable - calc.totalDistinctMemberBills).toLocaleString()} ৳</strong></div>
          <div class="border-t border-white/10 pt-1 font-bold text-white">Total to Collect: ${calc.totalMemberPayable.toLocaleString()} ৳</div>
        </div>
      </div>

      <!-- Cash Collected So Far (Illuminated Progress Track) -->
      <div class="has-tooltip glass-panel p-5 border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.5)] rounded-3xl relative overflow-hidden cursor-help">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Roommate Cash In</span>
          <div class="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-400/30 flex items-center justify-center text-sm shadow-[0_0_12px_rgba(99,102,241,0.2)]">
            📥
          </div>
        </div>
        <div class="mt-2.5 flex items-baseline gap-2">
          <span class="text-3xl font-black tabular-nums tracking-tight text-indigo-400">${calc.totalCashCollected.toLocaleString()}</span>
          <span class="text-xs font-bold text-slate-400">/ ${calc.totalMemberPayable.toLocaleString()} ৳</span>
        </div>
        <div class="mt-2.5 w-full bg-slate-900/80 rounded-full h-2 overflow-hidden shadow-inner border border-white/5">
          <div class="bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-500 h-2 rounded-full transition-all duration-500 shadow-[0_0_12px_rgba(99,102,241,0.7)]" style="width: ${percentRoommatesPaid}%"></div>
        </div>
        <div class="flex justify-between text-[10px] mt-1.5 font-bold">
          <span class="text-indigo-300">${percentRoommatesPaid}% Collected</span>
          <span class="text-rose-400">Pending: ${calc.totalMemberDueRemaining.toLocaleString()} ৳</span>
        </div>

        <!-- Tooltip -->
        <div class="tooltip-content p-3 rounded-2xl bg-slate-900 border border-white/15 text-slate-300 text-xs shadow-2xl space-y-1 font-normal">
          <div class="font-black text-white text-xs border-b border-white/10 pb-1">📥 Collection Progress</div>
          <div>Collected in Drawer: <strong class="text-emerald-400">${calc.totalCashCollected.toLocaleString()} ৳</strong></div>
          <div>Remaining to Collect: <strong class="text-rose-400">${calc.totalMemberDueRemaining.toLocaleString()} ৳</strong></div>
          <div class="border-t border-white/10 pt-1 text-slate-400 text-[10px]">${percentRoommatesPaid}% of total November member dues collected.</div>
        </div>
      </div>

      <!-- Outstanding Dues Pending -->
      <div class="has-tooltip glass-panel p-5 border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.5)] rounded-3xl relative overflow-hidden cursor-help">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Dues Pending</span>
          <div class="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-400/30 flex items-center justify-center text-sm shadow-[0_0_12px_rgba(244,63,94,0.2)]">
            ⏳
          </div>
        </div>
        <div class="mt-2.5 flex items-baseline gap-2">
          <span class="text-3xl font-black tabular-nums tracking-tight text-rose-400">${calc.totalMemberDueRemaining.toLocaleString()}</span>
          <span class="text-xs font-bold text-slate-400">BDT</span>
        </div>
        <p class="text-[11px] text-rose-400 font-semibold mt-1.5 flex items-center gap-1">
          <span>Uncollected from roommates</span>
        </p>

        <!-- Tooltip -->
        <div class="tooltip-content p-3 rounded-2xl bg-slate-900 border border-white/15 text-slate-300 text-xs shadow-2xl space-y-1 font-normal">
          <div class="font-black text-white text-xs border-b border-white/10 pb-1">⏳ Pending Roommate Dues</div>
          <div class="text-[11px] text-slate-300 leading-relaxed">
            Live uncollected amount across roommates. Once collected, reimburses any personal drawer deficit and clears vendor bills.
          </div>
        </div>
      </div>

      <!-- Mess Wallet -->
      <div class="has-tooltip glass-panel p-5 border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.5)] rounded-3xl relative overflow-hidden cursor-help">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Cash in Drawer (Wallet)</span>
          <div class="w-8 h-8 rounded-xl ${calc.cashInHand >= 0 ? 'bg-emerald-500/10 border-emerald-400/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]' : 'bg-rose-500/10 border-rose-400/30 shadow-[0_0_12px_rgba(244,63,94,0.2)]'} flex items-center justify-center text-sm">
            ${calc.cashInHand >= 0 ? '💵' : '⚠️'}
          </div>
        </div>
        <div class="mt-2.5 flex items-baseline gap-2">
          <span class="text-3xl font-black tabular-nums tracking-tight ${calc.cashInHand >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            ${calc.cashInHand >= 0 ? '+' : ''}${calc.cashInHand.toLocaleString()}
          </span>
          <span class="text-xs font-bold text-slate-400">BDT</span>
        </div>
        <p class="text-[11px] ${calc.cashInHand >= 0 ? 'text-emerald-400' : 'text-rose-400'} font-semibold mt-1.5">
          ${calc.cashInHand >= 0 ? 'Physical cash in mess drawer' : 'Personal pocket deficit, pending cash'}
        </p>

        <!-- Tooltip -->
        <div class="tooltip-content p-3 rounded-2xl bg-slate-900 border border-white/15 text-slate-300 text-xs shadow-2xl space-y-1.5 font-normal">
          <div class="font-black text-white text-xs border-b border-white/10 pb-1">💵 Cash in Drawer (Wallet)</div>
          <div class="text-[11px] flex justify-between">
            <span class="text-slate-400">Cash In (Collected):</span>
            <strong class="text-indigo-300 tabular-nums">+${calc.totalCashCollected.toLocaleString()} ৳</strong>
          </div>
          <div class="text-[11px] flex justify-between">
            <span class="text-slate-400">Cash Out (Bills Paid):</span>
            <strong class="text-rose-400 tabular-nums">-${calc.grandBillsPaid.toLocaleString()} ৳</strong>
          </div>
          <div class="border-t border-white/10 pt-1 text-xs font-black flex justify-between ${calc.cashInHand >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            <span>${calc.cashInHand >= 0 ? 'Drawer Cash:' : 'Out-of-Pocket Deficit:'}</span>
            <span class="tabular-nums">${calc.cashInHand >= 0 ? '+' : ''}${calc.cashInHand.toLocaleString()} ৳</span>
          </div>
        </div>
      </div>

    </div>

    <!-- SEGMENTED VIEW CONTROLLER (Linear / Bencho Style) -->
    <div class="flex flex-wrap items-center justify-between gap-3 pt-2 pb-1">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-white text-sm shadow-[0_0_12px_rgba(99,102,241,0.3)]">
          👥
        </div>
        <div>
          <h2 class="text-sm font-black text-white tracking-tight flex items-center gap-2">
            Roommate Accounts & Dues
          </h2>
          <p class="text-[11px] text-slate-400 font-medium">Distinct monthly costs and balances for ${currentMonth.name}</p>
        </div>
      </div>

      <!-- Segmented View Switcher Buttons -->
      <div class="flex items-center p-1 bg-slate-950/80 backdrop-blur-md rounded-2xl border border-white/10 shadow-inner text-xs font-black">
        <button id="viewBtnDual" class="px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === 'dual' ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-[0_0_16px_rgba(99,102,241,0.4)]' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'}" title="Show Cards and Table">
          <span>✨</span> Dual View
        </button>
        <button id="viewBtnTable" class="px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === 'table' ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-[0_0_16px_rgba(99,102,241,0.4)]' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'}" title="Master Table Only">
          <span>📋</span> Master Table
        </button>
        <button id="viewBtnCards" class="px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${viewMode === 'cards' ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-[0_0_16px_rgba(99,102,241,0.4)]' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'}" title="Action Cards Only">
          <span>💳</span> Action Cards
        </button>
      </div>
    </div>

    ${viewMode !== 'table' ? `
    <!-- BENTO STRIP: CURRENT DUES & MEMBER BALANCES -->
    <div class="glass-panel p-5 sm:p-6 border border-white/10 shadow-[0_16px_50px_rgba(0,0,0,0.6)] rounded-3xl">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-500 to-pink-500 flex items-center justify-center text-white text-base shadow-[0_0_16px_rgba(244,63,94,0.35)]">
            💳
          </div>
          <div>
            <h3 class="text-sm font-black text-white flex items-center gap-2">
              Current Dues & Member Balances (সদস্যদের বর্তমান বকেয়া)
            </h3>
            <p class="text-xs text-slate-400 font-medium">
              Live remaining amount owed by each roommate for ${currentMonth.name} (Total Billed minus Cash Received).
            </p>
          </div>
        </div>
        <span class="text-xs font-black text-rose-300 bg-rose-950/60 px-3.5 py-1.5 rounded-xl border border-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.2)] tabular-nums">
          Total Current Due: ${calc.totalMemberDueRemaining.toLocaleString()} ৳
        </span>
      </div>

      <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
        ${state.members.map(m => {
          const rec = currentMonth.memberRecords[m.id];
          const row = calc.rows.find(r => r.member.id === m.id);
          const remainingDue = row ? (row.remaining < 0 ? Math.abs(row.remaining) : (row.remaining > 0 ? -row.remaining : 0)) : 0;
          const isDue = row ? row.remaining < 0 : false;
          const isAdv = row ? row.remaining > 0 : false;
          const mentionVal = rec?.previousBalanceMention || (row && row.prevBal < 0 ? `Unpaid Past Due: ${Math.abs(row.prevBal)} ৳` : '');
          const avatar = getMemberAvatar(m);

          return `
            <div class="glass-card-interactive p-3.5 rounded-2xl border ${isDue ? 'border-rose-500/30 bg-rose-950/20 shadow-[0_0_16px_rgba(244,63,94,0.1)]' : isAdv ? 'border-cyan-500/30 bg-cyan-950/20 shadow-[0_0_16px_rgba(6,182,212,0.1)]' : 'border-white/10 bg-slate-900/40'} flex flex-col justify-between gap-2.5">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-xl bg-gradient-to-tr ${avatar.gradient} text-white font-black text-xs flex items-center justify-center shadow-md ring-1 ring-white/20 shrink-0">
                    ${avatar.initials}
                  </div>
                  <div>
                    <span class="font-extrabold text-white text-xs">${m.name}</span>
                    <div class="text-[10px] text-slate-400 font-semibold">${m.roomLabel}</div>
                  </div>
                </div>
                ${isDue ? `
                  <span class="text-[10px] font-black text-rose-300 bg-rose-950/70 px-2 py-0.5 rounded-lg border border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.2)]">Due ${remainingDue.toLocaleString()} ৳</span>
                ` : isAdv ? `
                  <span class="text-[10px] font-black text-cyan-300 bg-cyan-950/70 px-2 py-0.5 rounded-lg border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.2)]">+${Math.abs(remainingDue).toLocaleString()} ৳ Adv</span>
                ` : `
                  <span class="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-lg border border-emerald-500/30">✓ Cleared</span>
                `}
              </div>

              <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Current Due (বর্তমান বকেয়া):</label>
                <div class="flex items-center gap-1.5">
                  <input type="number" id="due_sec_${m.id}" data-mid="${m.id}" value="${remainingDue}" placeholder="0" step="any"
                    class="inputMemberDueSec glass-input w-full font-black text-xs ${isDue ? 'text-rose-300' : isAdv ? 'text-cyan-300' : 'text-emerald-400'} rounded-xl px-2.5 py-1.5 outline-none" />
                  <span class="text-xs font-bold text-slate-400">৳</span>
                </div>
              </div>

              ${row ? `
                <div class="flex items-center justify-between text-[10px] font-medium text-slate-400 border-t border-white/5 pt-1.5">
                  <span>Billed: <strong class="text-slate-200">${row.haveToPay.toLocaleString()} ৳</strong></span>
                  <span>Paid: <strong class="text-emerald-400">${row.totalPaid.toLocaleString()} ৳</strong></span>
                </div>
              ` : ''}

              <div class="flex items-center gap-1.5">
                <input type="text" id="due_note_${m.id}" data-mid="${m.id}" value="${mentionVal}" placeholder="Note / Reference"
                  class="inputMemberDueNoteSec glass-input flex-1 text-[10px] font-semibold text-slate-300 rounded-xl px-2.5 py-1 outline-none" />
                <button class="btnPayCash px-3 py-1 rounded-xl text-[10px] font-black bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] transition cursor-pointer"
                  data-id="${m.id}" data-name="${m.name}" data-due="${isDue ? remainingDue : 0}">
                  Pay
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
    ` : ''}

    ${viewMode !== 'cards' ? `
    <!-- MODERN OBSIDIAN GLASS MASTER TABLE (Side 1) -->
    <div class="glass-panel border border-white/10 shadow-[0_24px_60px_rgba(0,0,0,0.65)] rounded-3xl overflow-hidden backdrop-blur-xl">
      <div class="px-6 py-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-4 bg-slate-950/60">
        <div>
          <div class="flex items-center gap-2.5">
            <span class="text-lg">📋</span>
            <h2 class="text-base font-black text-white tracking-tight">
              Master Roommate Spreadsheet
            </h2>
          </div>
          <p class="text-xs text-slate-400 font-medium mt-0.5">
            Complete living charges, adjustments, and collection ledger for ${currentMonth.name}.
          </p>
        </div>
        
        <!-- Summary Stats Pills -->
        <div class="flex items-center gap-2 text-xs font-bold">
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 text-slate-300 border border-white/10 shadow-xs">
            <span class="w-2 h-2 rounded-full bg-slate-400"></span> Total: 7 Members
          </span>
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/25 shadow-xs tabular-nums">
            <span class="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]"></span> ${calc.totalMemberDueRemaining > 0 ? `${calc.totalMemberDueRemaining.toLocaleString()} ৳ Pending` : 'All Cleared'}
          </span>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <thead class="bg-slate-950/90 backdrop-blur-md text-slate-400 uppercase font-black text-[10px] tracking-wider border-b border-white/[0.08]">
            <tr>
              <th class="py-3.5 px-5 text-slate-300 whitespace-nowrap">Member</th>
              <th class="py-3.5 px-3 text-right whitespace-nowrap">Base Rent</th>
              <th class="py-3.5 px-3 text-right whitespace-nowrap has-tooltip cursor-help">
                <span>Bills Adj</span>
                <div class="tooltip-content p-2.5 rounded-xl bg-slate-900 border border-white/15 text-slate-300 text-[11px] font-normal shadow-2xl">
                  Monthly electricity difference from 160 base (+245 ৳/person for Nov).
                </div>
              </th>
              <th class="py-3.5 px-4 text-right text-indigo-400 font-black whitespace-nowrap has-tooltip cursor-help">
                <span>⭐ This Month</span>
                <div class="tooltip-content p-2.5 rounded-xl bg-slate-900 border border-white/15 text-slate-300 text-[11px] font-normal shadow-2xl">
                  Strictly this month's pure living cost (Base Rent + Bills Adj).
                </div>
              </th>
              <th class="py-3.5 px-3 text-right text-slate-200 whitespace-nowrap has-tooltip cursor-help">
                <span>Have To Pay</span>
                <div class="tooltip-content p-2.5 rounded-xl bg-slate-900 border border-white/15 text-slate-300 text-[11px] font-normal shadow-2xl">
                  Total cumulative amount owed (This Month's Bill + Past Unpaid Arrears).
                </div>
              </th>
              <th class="py-3.5 px-3 text-right text-emerald-400 whitespace-nowrap has-tooltip cursor-help">
                <span>Cash Received</span>
                <div class="tooltip-content p-2.5 rounded-xl bg-slate-900 border border-white/15 text-slate-300 text-[11px] font-normal shadow-2xl">
                  Physical cash collected and placed into mess drawer.
                </div>
              </th>
              <th class="py-3.5 px-4 text-right text-rose-400 whitespace-nowrap has-tooltip cursor-help">
                <span>Total Current Due</span>
                <div class="tooltip-content p-2.5 rounded-xl bg-slate-900 border border-white/15 text-slate-300 text-[11px] font-normal shadow-2xl">
                  Live remaining balance owed (Have To Pay minus Cash Received).
                </div>
              </th>
              <th class="py-3.5 px-5 text-center whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/[0.06]">
            ${calc.rows.map(row => {
              const m = row.member;
              const isPaid = row.remaining === 0;
              const isOverdue = row.remaining < 0;
              const avatar = getMemberAvatar(m);

              return `
                <tr class="hover:bg-white/[0.035] transition-colors duration-150 group">
                  <!-- Member Info with Gradient Avatar -->
                  <td class="py-3.5 px-5">
                    <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr ${avatar.gradient} text-white font-black text-xs flex items-center justify-center shadow-md ring-1 ring-white/20 shrink-0">
                        ${avatar.initials}
                      </div>
                      <div>
                        <div class="font-extrabold text-white text-sm group-hover:text-indigo-300 transition-colors">${m.name}</div>
                        <div class="text-[11px] text-slate-400 font-medium">${m.roomLabel}</div>
                      </div>
                    </div>
                  </td>

                  <!-- Base Rent -->
                  <td class="py-3.5 px-3 text-right font-bold text-slate-300 tabular-nums text-xs">
                    ${m.baseRent.toLocaleString()} ৳
                  </td>

                  <!-- Bill Delta (±) -->
                  <td class="py-3.5 px-3 text-right font-extrabold tabular-nums text-xs">
                    ${row.perPersonDelta > 0 
                      ? `<span class="text-amber-400">+${row.perPersonDelta}</span>` 
                      : row.perPersonDelta < 0 
                        ? `<span class="text-emerald-400">${row.perPersonDelta}</span>` 
                        : `<span class="text-slate-500">0</span>`}
                  </td>

                  <!-- ⭐ This Month (Distinct) -->
                  <td class="py-3.5 px-4 text-right">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-lg font-black text-indigo-300 text-xs bg-indigo-500/10 border border-indigo-500/20 tabular-nums">
                      ${row.distinctThisMonth.toLocaleString()} ৳
                    </span>
                  </td>

                  <!-- Total Have To Pay -->
                  <td class="py-3.5 px-3 text-right font-black text-white text-xs tabular-nums">
                    ${row.haveToPay.toLocaleString()} ৳
                  </td>

                  <!-- Total Paid -->
                  <td class="py-3.5 px-3 text-right">
                    <div class="font-black text-emerald-400 text-xs tabular-nums">${row.totalPaid.toLocaleString()} ৳</div>
                    <div class="text-[10px] text-slate-400 font-medium">
                      (${row.payments.length} pmt${row.payments.length === 1 ? '' : 's'}${row.expenseCredit > 0 ? ` + ${row.expenseCredit}৳ exp` : ''})
                    </div>
                  </td>

                  <!-- Total Current Due / Status -->
                  <td class="py-3.5 px-4 text-right">
                    ${isPaid ? `
                      <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-black bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
                        ✓ Due 0 ৳
                      </span>
                    ` : isOverdue ? `
                      <div class="inline-flex flex-col items-end">
                        <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-black bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-[0_0_14px_rgba(244,63,94,0.18)] tabular-nums">
                          Due ${Math.abs(row.remaining).toLocaleString()} ৳
                        </span>
                        ${row.prevBal < 0 && (row.distinctThisMonth > row.totalPaid) ? `
                          <span class="text-[9px] text-slate-400 font-medium mt-0.5 tabular-nums">
                            (Past ${Math.abs(row.prevBal).toLocaleString()}৳ + Month ${(row.distinctThisMonth - row.totalPaid).toLocaleString()}৳)
                          </span>
                        ` : ''}
                      </div>
                    ` : `
                      <div class="inline-flex flex-col items-end gap-0.5">
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          Due: 0 ৳
                        </span>
                        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 tabular-nums">
                          +${row.remaining.toLocaleString()} ৳ Adv
                        </span>
                      </div>
                    `}
                  </td>

                  <!-- Actions -->
                  <td class="py-3.5 px-5 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                      <button class="btnPayCash inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50 hover:shadow-[0_0_16px_rgba(16,185,129,0.25)] transition-all cursor-pointer active:scale-95" 
                        data-id="${m.id}" data-name="${m.name}" data-due="${row.remaining < 0 ? Math.abs(row.remaining) : 0}">
                        <span class="text-xs">💵</span>
                        <span>Pay</span>
                      </button>
                      <button class="btnLedger inline-flex items-center justify-center px-2 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 hover:border-white/20 text-xs font-bold transition shadow-xs cursor-pointer active:scale-95"
                        data-id="${m.id}" data-name="${m.name}" title="View Payment History">
                        <span>📜 ${row.payments.length}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot class="bg-slate-950/90 backdrop-blur-md font-black text-white border-t border-white/[0.08]">
            <tr>
              <td class="py-3.5 px-5 uppercase tracking-wider text-[10px] text-slate-400">TOTALS</td>
              <td class="py-3.5 px-3 text-right tabular-nums text-slate-300 text-xs">${calc.totalBaseRent.toLocaleString()} ৳</td>
              <td class="py-3.5 px-3 text-right tabular-nums text-xs">${calc.deltaFromBase > 0 ? `+${calc.deltaFromBase}` : calc.deltaFromBase} ৳</td>
              <td class="py-3.5 px-4 text-right text-xs text-indigo-300 tabular-nums">
                <span class="inline-flex items-center px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 font-black">
                  ${calc.totalDistinctMemberBills.toLocaleString()} ৳
                </span>
              </td>
              <td class="py-3.5 px-3 text-right text-xs text-white tabular-nums">${calc.totalMemberPayable.toLocaleString()} ৳</td>
              <td class="py-3.5 px-3 text-right text-xs text-emerald-400 tabular-nums">${calc.totalCashCollected.toLocaleString()} ৳</td>
              <td class="py-3.5 px-4 text-right tabular-nums">
                <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-black bg-rose-500/15 text-rose-300 border border-rose-500/30">
                  Total Due: ${calc.totalMemberDueRemaining.toLocaleString()} ৳
                </span>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    ` : ''}
  `;
}

// --- PAGE 2: SIDE 2 (Flat Bills & Landlord Payouts - Cash Out) ---
function renderSide2(currentMonth: MonthData, calc: ReturnType<typeof calculateMonth>, percentBillsPaid: number, l: LandlordPackage) {
  return `
    <!-- Side 2 Bento Stat Tiles -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      
      <!-- Total Distinct Bills -->
      <div class="glass-panel p-5 border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.5)] rounded-3xl relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">⭐ This Month's Distinct Bill</span>
          <div class="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-400/30 flex items-center justify-center text-sm shadow-[0_0_12px_rgba(99,102,241,0.2)]">
            🧾
          </div>
        </div>
        <div class="mt-2.5 flex items-baseline gap-2">
          <span class="text-3xl font-black tabular-nums tracking-tight text-white">${calc.grandDistinctMonthBills.toLocaleString()}</span>
          <span class="text-xs font-bold text-slate-400">BDT</span>
        </div>
        <p class="text-[11px] text-slate-400 font-semibold mt-1.5 flex items-center gap-1.5">
          <span>Landlord: <strong class="text-indigo-300">${calc.landlordDistinctMonth.toLocaleString()} ৳</strong></span>
          <span class="text-slate-600">•</span>
          <span>Others: <strong class="text-slate-200">${(calc.otherBillsDistinctMonth + currentMonth.commonExpenses.reduce((s,e)=>s+e.amount,0)).toLocaleString()} ৳</strong></span>
        </p>
      </div>

      <!-- Bills Paid vs Remaining (Illuminated Progress Track) -->
      <div class="glass-panel p-5 border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.5)] rounded-3xl relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Bills Paid to Vendors</span>
          <div class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center text-sm shadow-[0_0_12px_rgba(16,185,129,0.2)]">
            📤
          </div>
        </div>
        <div class="mt-2.5 flex items-baseline gap-2">
          <span class="text-3xl font-black tabular-nums tracking-tight text-emerald-400">${calc.grandBillsPaid.toLocaleString()}</span>
          <span class="text-xs font-bold text-slate-400">/ ${calc.grandCumulativeBills.toLocaleString()} ৳</span>
        </div>
        <div class="mt-2.5 w-full bg-slate-900/80 rounded-full h-2 overflow-hidden shadow-inner border border-white/5">
          <div class="bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 h-2 rounded-full transition-all duration-500 shadow-[0_0_12px_rgba(16,185,129,0.7)]" style="width: ${percentBillsPaid}%"></div>
        </div>
        <div class="flex justify-between text-[10px] mt-1.5 font-bold">
          <span class="text-emerald-300">${percentBillsPaid}% Cleared</span>
          <span class="text-rose-400">Remaining: ${calc.grandBillsRemaining.toLocaleString()} ৳</span>
        </div>
      </div>

      <!-- Landlord Status -->
      <div class="glass-panel p-5 border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.5)] rounded-3xl relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Landlord Package Status</span>
          <div class="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-center text-sm shadow-[0_0_12px_rgba(245,158,11,0.2)]">
            🏠
          </div>
        </div>
        <div class="mt-2.5 flex items-baseline gap-2">
          <span class="text-3xl font-black tabular-nums tracking-tight ${calc.isLandlordCleared ? 'text-emerald-400' : 'text-rose-400'}">
            ${calc.landlordRemainingDue > 0 ? calc.landlordRemainingDue.toLocaleString() : '0'}
          </span>
          <span class="text-xs font-bold ${calc.isLandlordCleared ? 'text-emerald-400' : 'text-slate-400'}">${calc.isLandlordCleared ? 'BDT (Cleared ✓)' : 'BDT Due'}</span>
        </div>
        <p class="text-[11px] text-slate-400 font-semibold mt-1.5">
          Paid ${calc.landlordTotalPaid.toLocaleString()} of ${calc.landlordTotalPayable.toLocaleString()} ৳
        </p>
      </div>

      <!-- Mess Wallet -->
      <div class="glass-panel p-5 border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.5)] rounded-3xl relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Cash in Drawer (Wallet)</span>
          <div class="w-8 h-8 rounded-xl ${calc.cashInHand >= 0 ? 'bg-emerald-500/10 border-emerald-400/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]' : 'bg-rose-500/10 border-rose-400/30 shadow-[0_0_12px_rgba(244,63,94,0.2)]'} flex items-center justify-center text-sm">
            ${calc.cashInHand >= 0 ? '💵' : '⚠️'}
          </div>
        </div>
        <div class="mt-2.5 flex items-baseline gap-2">
          <span class="text-3xl font-black tabular-nums tracking-tight ${calc.cashInHand >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            ${calc.cashInHand >= 0 ? '+' : ''}${calc.cashInHand.toLocaleString()}
          </span>
          <span class="text-xs font-bold text-slate-400">BDT</span>
        </div>
        <p class="text-[11px] ${calc.cashInHand >= 0 ? 'text-emerald-400' : 'text-rose-400'} font-semibold mt-1.5">
          ${calc.cashInHand >= 0 ? 'Physical cash in mess drawer' : 'Personal pocket deficit, pending cash'}
        </p>
      </div>

    </div>

    <!-- SECTION 1: THE UNIFIED LANDLORD PACKAGE (Executive Financial Terminal) -->
    <div class="glass-panel border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.6)] rounded-3xl overflow-hidden">
      <div class="px-6 py-4.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-4 bg-slate-950/40">
        <div>
          <div class="flex items-center gap-2.5">
            <span class="text-2xl">🏠</span>
            <h2 class="text-base font-black text-white tracking-tight">
              Landlord Payout Package (বাড়িওয়ালার এককালীন বিল)
            </h2>
            <span class="text-xs font-black px-3 py-1 rounded-xl ${calc.isLandlordCleared ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-amber-950/60 text-amber-300 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]'}">
              ${calc.isLandlordCleared ? '✓ Fully Cleared' : `⏳ ${calc.landlordRemainingDue.toLocaleString()} ৳ Remaining`}
            </span>
          </div>
          <p class="text-xs text-slate-400 font-medium mt-0.5">
            These 5 items + past due are paid together to the landlord. Supports paying in <strong class="text-slate-200">installments/partial payments</strong>!
          </p>
        </div>

        <!-- Landlord Summary & Action Buttons -->
        <div class="flex items-center gap-4">
          <div class="text-right">
            <div class="text-[10px] text-slate-400 font-black uppercase tracking-wider">Total Payable to Landlord:</div>
            <div class="text-2xl font-black text-white tabular-nums">
              ${calc.landlordTotalPayable.toLocaleString()} <span class="text-xs font-bold text-slate-400">৳</span>
            </div>
            <div class="text-[10px] text-slate-400 font-medium">
              (This Month: ${calc.landlordDistinctMonth.toLocaleString()} ৳${calc.landlordPrevDue > 0 ? ` + Past Due: ${calc.landlordPrevDue.toLocaleString()} ৳` : ''})
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button id="btnPayLandlord" class="px-4 py-2.5 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center gap-1.5 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer">
              <span>💵</span> + Pay Landlord Cash
            </button>
            <button id="btnLandlordHistory" class="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-white/10 shadow-xs transition cursor-pointer" title="View Installments Paid to Landlord">
              📜 History (${l.payments.length})
            </button>
          </div>
        </div>
      </div>

      <!-- Distinct Separation Banner inside Landlord Card -->
      <div class="px-6 py-3 bg-slate-950/60 border-b border-white/10 text-xs flex flex-wrap items-center justify-between gap-2.5 text-slate-300">
        <div class="flex items-center gap-4">
          <span>⭐ <strong>This Month's Distinct Bill:</strong> <span class="font-black text-white">${calc.landlordDistinctMonth.toLocaleString()} ৳</span></span>
          ${calc.landlordPrevDue > 0 ? `
            <span class="text-amber-300 bg-amber-950/60 px-2.5 py-1 rounded-xl border border-amber-500/30 font-bold shadow-[0_0_10px_rgba(245,158,11,0.15)]">
              ⚠️ Previous Landlord Due: <strong>+${calc.landlordPrevDue.toLocaleString()} ৳</strong> ${l.previousDueMention ? `(${l.previousDueMention})` : ''}
            </span>
          ` : '<span class="text-slate-500 font-semibold">Previous Due: 0 ৳</span>'}
        </div>

        <div class="flex items-center gap-3 font-semibold">
          <span>Paid so far: <strong class="text-emerald-400">${calc.landlordTotalPaid.toLocaleString()} ৳</strong> (${l.payments.length} installments)</span>
          <span>Remaining: <strong class="${calc.landlordRemainingDue > 0 ? 'text-rose-400 font-black' : 'text-emerald-400 font-black'}">${calc.landlordRemainingDue > 0 ? calc.landlordRemainingDue.toLocaleString() + ' ৳' : '0 ৳ (Cleared)'}</strong></span>
        </div>
      </div>

      <!-- 6 Sub-Items Grid (Includes Dedicated Landlord Previous Due Input) -->
      <div class="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        
        <!-- 1. Vasa Vara -->
        <div class="glass-card-interactive p-4 rounded-2xl border border-white/10 bg-slate-900/40 flex flex-col justify-between">
          <div class="flex items-center justify-between text-xs font-black text-slate-200 mb-1">
            <span>🏠 Vasa Vara</span>
          </div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">House Rent:</label>
          <div class="flex items-center gap-1.5">
            <input type="number" id="inputLandlordRent" value="${l.rent}" min="0" step="any"
              class="glass-input w-full font-black text-white rounded-xl px-2.5 py-1.5 text-sm outline-none" />
            <span class="text-xs font-bold text-slate-500">৳</span>
          </div>
        </div>

        <!-- 2. Gas Bill -->
        <div class="glass-card-interactive p-4 rounded-2xl border border-white/10 bg-slate-900/40 flex flex-col justify-between">
          <div class="flex items-center justify-between text-xs font-black text-slate-200 mb-1">
            <span>🔥 Gas Bill</span>
          </div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Gas Cylinder/Line:</label>
          <div class="flex items-center gap-1.5">
            <input type="number" id="inputLandlordGas" value="${l.gas}" min="0" step="any"
              class="glass-input w-full font-black text-white rounded-xl px-2.5 py-1.5 text-sm outline-none" />
            <span class="text-xs font-bold text-slate-500">৳</span>
          </div>
        </div>

        <!-- 3. Lift Bill -->
        <div class="glass-card-interactive p-4 rounded-2xl border border-white/10 bg-slate-900/40 flex flex-col justify-between">
          <div class="flex items-center justify-between text-xs font-black text-slate-200 mb-1">
            <span>🛗 Lift Bill</span>
            <span class="text-[10px] text-slate-400 font-bold">200×7</span>
          </div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Lift (7 heads):</label>
          <div class="flex items-center gap-1.5">
            <input type="number" id="inputLandlordLift" value="${l.lift}" min="0" step="any"
              class="glass-input w-full font-black text-white rounded-xl px-2.5 py-1.5 text-sm outline-none" />
            <span class="text-xs font-bold text-slate-500">৳</span>
          </div>
        </div>

        <!-- 4. Water Bill -->
        <div class="glass-card-interactive p-4 rounded-2xl border border-white/10 bg-slate-900/40 flex flex-col justify-between">
          <div class="flex items-center justify-between text-xs font-black text-slate-200 mb-1">
            <span>💧 Water Bill</span>
            <span class="text-[10px] text-slate-400 font-bold">200×7</span>
          </div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Water (7 heads):</label>
          <div class="flex items-center gap-1.5">
            <input type="number" id="inputLandlordWater" value="${l.water}" min="0" step="any"
              class="glass-input w-full font-black text-white rounded-xl px-2.5 py-1.5 text-sm outline-none" />
            <span class="text-xs font-bold text-slate-500">৳</span>
          </div>
        </div>

        <!-- 5. Electricity Bill -->
        <div class="glass-card-interactive p-4 rounded-2xl border border-white/10 bg-slate-900/40 flex flex-col justify-between">
          <div class="flex items-center justify-between text-xs font-black text-slate-200 mb-1">
            <span>⚡ Electricity</span>
            <span class="text-[10px] text-indigo-300 bg-indigo-950/60 font-bold px-1.5 py-0.5 rounded border border-indigo-500/30">${currentMonth.unitRate || 10}৳/u</span>
          </div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Elec Total Bill:</label>
          <div class="flex items-center gap-1.5">
            <input type="number" id="inputLandlordElec" value="${l.electricity}" min="0" step="any"
              class="glass-input w-full font-black text-white rounded-xl px-2.5 py-1.5 text-sm outline-none" />
            <span class="text-xs font-bold text-slate-500">৳</span>
          </div>
        </div>

        <!-- 6. ⚠️ Previous Landlord Due (Dedicated Input Section) -->
        <div class="glass-card-interactive p-4 rounded-2xl border border-rose-500/30 bg-rose-950/20 shadow-[0_0_16px_rgba(244,63,94,0.1)] flex flex-col justify-between">
          <div class="flex items-center justify-between text-xs font-black text-rose-300 mb-1">
            <span>⚠️ Previous Due</span>
            <span class="text-[10px] text-rose-300 bg-rose-950/70 px-1.5 py-0.5 rounded-md font-bold border border-rose-500/40">Arrears</span>
          </div>
          <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Landlord Past Due:</label>
          <div class="flex items-center gap-1.5">
            <input type="number" id="inputLandlordPrevDue" value="${l.previousDue || 0}" min="0" step="any"
              class="glass-input w-full font-black text-rose-300 rounded-xl px-2.5 py-1.5 text-sm outline-none" />
            <span class="text-xs font-bold text-slate-500">৳</span>
          </div>
          <div class="mt-2">
            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Due Note:</label>
            <input type="text" id="inputLandlordPrevDueNote" value="${l.previousDueMention || ''}" placeholder="e.g. Unpaid from Oct"
              class="glass-input w-full text-[11px] font-semibold text-slate-300 rounded-xl px-2 py-1 outline-none" />
          </div>
        </div>

      </div>

      <!-- Meter Tuning Sub-bar -->
      <div class="px-6 py-3.5 bg-slate-950/70 border-t border-white/10 text-xs flex flex-wrap items-center justify-between gap-4 text-slate-300">
        <div class="flex items-center gap-3">
          <span class="font-extrabold text-white flex items-center gap-1.5">⚡ Electricity Meter:</span>
          <div class="flex items-center gap-1.5">
            <span class="text-slate-400 font-bold text-[11px]">Units:</span>
            <input type="number" id="inputElecUnits" value="${currentMonth.electricityUnits || 160}" min="0" step="any"
              class="glass-input w-20 font-black text-white rounded-lg px-2 py-1 text-xs outline-none" />
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-slate-400 font-bold text-[11px]">Rate:</span>
            <input type="number" id="inputUnitRate" value="${currentMonth.unitRate || 10}" min="1" step="any"
              class="glass-input w-16 font-black text-white rounded-lg px-2 py-1 text-xs outline-none" />
            <span class="text-slate-400 font-bold text-[11px]">৳/u</span>
          </div>
        </div>

        <div class="flex items-center gap-4 text-[11px]">
          <!-- Visual progress gauge -->
          <div class="hidden sm:flex items-center gap-2">
            <span class="text-[10px] text-slate-400 font-mono">160u base</span>
            <div class="w-24 h-2 bg-slate-800 rounded-full overflow-hidden border border-white/10">
              <div class="h-full ${calc.unitsDiff > 0 ? 'bg-gradient-to-r from-amber-500 to-rose-500' : 'bg-emerald-500'}" style="width: ${Math.min(100, Math.max(15, ((currentMonth.electricityUnits || 160) / 400) * 100))}%"></div>
            </div>
            <span class="text-[10px] font-bold ${calc.unitsDiff > 0 ? 'text-rose-400' : 'text-emerald-400'} font-mono">${currentMonth.electricityUnits || 160}u</span>
          </div>

          <div class="text-[11px] text-slate-400 font-semibold flex items-center gap-3">
            <span>Diff: <strong class="text-slate-200">${calc.unitsDiff > 0 ? '+' : ''}${calc.unitsDiff} units (${calc.totalElecAdj > 0 ? '+' : ''}${calc.totalElecAdj} ৳)</strong></span>
            <span>Per Person: <strong class="${calc.elecAdjPerPerson >= 0 ? 'text-amber-400 font-black' : 'text-emerald-400 font-black'}">${calc.elecAdjPerPerson > 0 ? '+' : ''}${calc.elecAdjPerPerson} ৳</strong></span>
          </div>
        </div>
      </div>

    </div>

    <!-- SECTION 2: OTHER INDEPENDENT BILLS & COMMON EXPENSES -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      
      <!-- Other Independent Bills (Wi-Fi, Cleaning, Moyla) -->
      <div class="lg:col-span-2 glass-panel p-6 border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.6)] rounded-3xl">
        <div class="flex items-center justify-between pb-3.5 border-b border-white/10 mb-4">
          <div>
            <h3 class="text-sm font-black text-white flex items-center gap-2">
              <span>📶</span> Independent Utility Bills (Paid to other vendors)
            </h3>
            <p class="text-xs text-slate-400 font-medium">Wi-Fi, Cleaning Lady (Khala/Bua), and Garbage collection paid separately.</p>
          </div>
          <span class="text-xs font-black text-slate-300 bg-slate-900/80 px-3 py-1 rounded-xl border border-white/10 shadow-xs">
            Total: ${calc.otherBillsDistinctMonth.toLocaleString()} ৳
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          ${Object.values(currentMonth.otherBills).map(b => `
            <div class="glass-card-interactive p-4 rounded-2xl border ${b.isPaid ? 'border-emerald-500/30 bg-emerald-950/20 shadow-[0_0_14px_rgba(16,185,129,0.1)]' : 'border-white/10 bg-slate-900/40'} flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-black text-white flex items-center gap-1.5">
                    <span>${b.icon}</span> ${b.title}
                  </span>
                  ${b.isPaid ? `
                    <span class="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)]">✓ Paid</span>
                  ` : `
                    <span class="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-950/70 text-rose-300 border border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.2)]">⏳ Unpaid</span>
                  `}
                </div>

                <div class="mt-2">
                  <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Amount (BDT):</label>
                  <div class="flex items-center gap-1.5">
                    <input type="number" class="inputOtherBillAmount glass-input w-full font-black text-white rounded-xl px-2.5 py-1.5 text-xs outline-none"
                      data-bid="${b.id}" value="${b.amount}" min="0" step="any" />
                    <span class="text-xs font-bold text-slate-500">৳</span>
                  </div>
                </div>

                ${b.isPaid ? `
                  <div class="mt-2.5 text-[10px] font-bold text-emerald-300 bg-emerald-950/60 p-2 rounded-xl border border-emerald-500/30">
                    Paid on: <strong>${b.paidDate || 'Recorded'}</strong>
                  </div>
                ` : ''}
              </div>

              <div class="mt-3.5 pt-2 border-t border-white/10">
                ${b.isPaid ? `
                  <button class="btnToggleOtherUnpaid text-[11px] font-bold text-slate-400 hover:text-rose-400 transition cursor-pointer" data-bid="${b.id}">
                    ↩ Mark Unpaid
                  </button>
                ` : `
                  <button class="btnMarkOtherPaid w-full py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_16px_rgba(16,185,129,0.35)] transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                    data-bid="${b.id}" data-title="${b.title}" data-amount="${b.amount}">
                    Pay Cash (${b.amount} ৳)
                  </button>
                `}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Common Flat Supplies (Harpic, Kit, Repairs) -->
      <div class="glass-panel p-6 border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.6)] rounded-3xl flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between pb-3.5 border-b border-white/10 mb-3">
            <div>
              <h3 class="text-sm font-black text-white flex items-center gap-1.5">
                <span>🛒</span> Shared Supplies
              </h3>
              <p class="text-[11px] text-slate-400 font-medium">Harpic, Water kit, Router repair</p>
            </div>
            <button id="btnAddExpense" class="text-xs font-black text-indigo-300 bg-indigo-950/60 hover:bg-indigo-900/80 px-3 py-1.5 rounded-xl border border-indigo-500/30 transition cursor-pointer shadow-[0_0_12px_rgba(99,102,241,0.2)]">
              + Add
            </button>
          </div>

          <div class="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
            ${currentMonth.commonExpenses.length === 0 ? `
              <div class="text-center py-8 text-slate-400 text-xs font-medium">No shared supplies added this month.</div>
            ` : currentMonth.commonExpenses.map(exp => {
              const payer = state.members.find(m => m.id === exp.paidBy);
              return `
                <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-xs shadow-xs">
                  <div>
                    <div class="font-black text-white">${exp.title}</div>
                    <div class="text-[10px] text-slate-400 font-semibold">${exp.amount.toLocaleString()} ৳ • Paid by ${payer ? payer.name : 'Mess'} (${exp.date})</div>
                  </div>
                  <button class="btnDeleteExpense text-slate-400 hover:text-rose-400 px-1 font-bold cursor-pointer" data-id="${exp.id}">✕</button>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-white/10 flex justify-between text-xs text-white font-black">
          <span>Supplies Total:</span>
          <span class="tabular-nums">${currentMonth.commonExpenses.reduce((s, e) => s + e.amount, 0).toLocaleString()} ৳</span>
        </div>
      </div>

    </div>
  `;
}

// Activity Log generator (Glassmorphic timeline)
function renderActivityLog(month: MonthData) {
  const events: Array<{ date: string; type: 'in' | 'out'; text: string; amount: number }> = [];

  // 1. Roommate collections
  Object.values(month.memberRecords).forEach(rec => {
    const m = state.members.find(x => x.id === rec.memberId);
    rec.payments.forEach(p => {
      events.push({
        date: p.date,
        type: 'in',
        text: `Received Cash from ${m ? m.name : rec.memberId}${p.note ? ` (${p.note})` : ''}`,
        amount: p.amount
      });
    });
  });

  // 2. Landlord Package installment payouts
  const l = month.landlord;
  if (l && l.payments) {
    l.payments.forEach(p => {
      events.push({
        date: p.date,
        type: 'out',
        text: `Paid Landlord Cash Installment${p.note ? ` (${p.note})` : ''}`,
        amount: p.amount
      });
    });
  }

  // 3. Other Bills payouts
  if (month.otherBills) {
    Object.values(month.otherBills).forEach(b => {
      if (b.isPaid && b.paidDate) {
        events.push({
          date: b.paidDate,
          type: 'out',
          text: `Paid ${b.title} in Cash${b.paidNote ? ` (${b.paidNote})` : ''}`,
          amount: b.amount
        });
      }
    });
  }

  // 4. Common Expenses
  month.commonExpenses.forEach(exp => {
    const payer = state.members.find(x => x.id === exp.paidBy);
    events.push({
      date: exp.date,
      type: 'out',
      text: `Paid for ${exp.title} (by ${payer ? payer.name : 'Mess'})`,
      amount: exp.amount
    });
  });

  events.sort((a, b) => b.date.localeCompare(a.date));

  if (events.length === 0) {
    return `<div class="text-center py-8 text-slate-500 text-xs font-semibold">No cash transactions recorded for this month yet.</div>`;
  }

  return events.map(ev => `
    <div class="flex items-center justify-between p-3 rounded-2xl bg-slate-900/50 border border-white/10 shadow-xs hover:bg-slate-900/80 transition text-xs">
      <div class="flex items-center gap-3">
        <span class="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm ${ev.type === 'in' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-rose-950/60 text-rose-300 border border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.2)]'}">
          ${ev.type === 'in' ? '📥' : '📤'}
        </span>
        <div>
          <div class="font-black text-white">${ev.text}</div>
          <div class="text-[10px] text-slate-400 font-semibold">${ev.date} • ${ev.type === 'in' ? 'Cash In (Collection)' : 'Cash Out (Bill Paid)'}</div>
        </div>
      </div>
      <div class="font-black text-sm tabular-nums ${ev.type === 'in' ? 'text-emerald-400' : 'text-rose-400'}">
        ${ev.type === 'in' ? '+' : '-'}${ev.amount.toLocaleString()} ৳
      </div>
    </div>
  `).join('');
}

// --- Attach Event Listeners ---
function attachEventListeners() {
  const currentMonth = state.months.find(m => m.id === state.currentMonthId) || state.months[state.months.length - 1];
  const l = currentMonth.landlord;

  // TAB SWITCHING: Side 1 vs Side 2
  document.getElementById('tabSide1')?.addEventListener('click', () => {
    state.activePage = 'side1';
    saveState();
    render();
  });

  document.getElementById('tabSide2')?.addEventListener('click', () => {
    state.activePage = 'side2';
    saveState();
    render();
  });

  // Month select change
  document.getElementById('monthSelect')?.addEventListener('change', (e) => {
    state.currentMonthId = (e.target as HTMLSelectElement).value;
    saveState();
    render();
  });

  // 1. Landlord Inputs
  const bindLandlordInput = (elemId: string, field: 'rent' | 'gas' | 'lift' | 'water' | 'electricity') => {
    const el = document.getElementById(elemId) as HTMLInputElement;
    el?.addEventListener('input', () => {
      const val = parseFloat(el.value);
      if (!isNaN(val)) {
        l[field] = val;
        saveState();
        render();
      }
    });
  };

  bindLandlordInput('inputLandlordRent', 'rent');
  bindLandlordInput('inputLandlordGas', 'gas');
  bindLandlordInput('inputLandlordLift', 'lift');
  bindLandlordInput('inputLandlordWater', 'water');
  bindLandlordInput('inputLandlordElec', 'electricity');

  // Dedicated Landlord Previous Due Input
  const inputPrevDue = document.getElementById('inputLandlordPrevDue') as HTMLInputElement;
  inputPrevDue?.addEventListener('input', () => {
    const val = parseFloat(inputPrevDue.value);
    l.previousDue = isNaN(val) ? 0 : val;
    saveState();
    render();
  });

  const inputPrevDueNote = document.getElementById('inputLandlordPrevDueNote') as HTMLInputElement;
  inputPrevDueNote?.addEventListener('input', () => {
    l.previousDueMention = inputPrevDueNote.value;
    saveState();
  });

  // Dedicated Roommate Dues Section Inputs (Side 1)
  document.querySelectorAll('.inputMemberDueSec').forEach(input => {
    input.addEventListener('input', () => {
      const mid = (input as HTMLElement).dataset.mid!;
      const val = parseFloat((input as HTMLInputElement).value);
      if (!currentMonth.memberRecords[mid]) {
        currentMonth.memberRecords[mid] = { memberId: mid, previousBalance: 0, payments: [] };
      }
      const calc = calculateMonth(currentMonth, state.members);
      const row = calc.rows.find(r => r.member.id === mid);
      if (row) {
        const targetDue = isNaN(val) ? 0 : val;
        // previousBalance = distinctThisMonth - totalPaid - targetDue
        currentMonth.memberRecords[mid].previousBalance = row.distinctThisMonth - row.totalPaid - targetDue;
      }
      saveState();
      render();
    });
  });

  document.querySelectorAll('.inputMemberDueNoteSec').forEach(input => {
    input.addEventListener('input', () => {
      const mid = (input as HTMLElement).dataset.mid!;
      const val = (input as HTMLInputElement).value;
      if (!currentMonth.memberRecords[mid]) {
        currentMonth.memberRecords[mid] = { memberId: mid, previousBalance: 0, payments: [] };
      }
      currentMonth.memberRecords[mid].previousBalanceMention = val;
      saveState();
    });
  });


  // Pay Landlord Cash Installment
  document.getElementById('btnPayLandlord')?.addEventListener('click', () => {
    const calc = calculateMonth(currentMonth, state.members);
    openPayLandlordModal(Math.max(0, calc.landlordRemainingDue));
  });

  // Landlord Installment History
  document.getElementById('btnLandlordHistory')?.addEventListener('click', () => {
    openLandlordHistoryModal();
  });

  // Electricity Units tuning
  const inputElec = document.getElementById('inputElecUnits') as HTMLInputElement;
  inputElec?.addEventListener('input', () => {
    const val = parseInt(inputElec.value, 10);
    currentMonth.electricityUnits = isNaN(val) ? 160 : val;
    const unitsDiff = (currentMonth.electricityUnits || 160) - 160;
    const rate = currentMonth.unitRate || 10;
    l.electricity = 2000 + (unitsDiff * rate);
    saveState();
    render();
  });

  // Electricity Unit Cost tuning
  const inputRate = document.getElementById('inputUnitRate') as HTMLInputElement;
  inputRate?.addEventListener('input', () => {
    const val = parseFloat(inputRate.value);
    currentMonth.unitRate = isNaN(val) ? 10 : val;
    const unitsDiff = (currentMonth.electricityUnits || 160) - 160;
    l.electricity = 2000 + (unitsDiff * currentMonth.unitRate);
    saveState();
    render();
  });

  // Other Independent Bills Inputs
  document.querySelectorAll('.inputOtherBillAmount').forEach(input => {
    input.addEventListener('input', () => {
      const bid = (input as HTMLElement).dataset.bid!;
      const val = parseFloat((input as HTMLInputElement).value);
      if (currentMonth.otherBills && currentMonth.otherBills[bid] && !isNaN(val)) {
        currentMonth.otherBills[bid].amount = val;
        saveState();
        render();
      }
    });
  });

  // Mark Other Bill as Paid
  document.querySelectorAll('.btnMarkOtherPaid').forEach(btn => {
    btn.addEventListener('click', () => {
      const bid = (btn as HTMLElement).dataset.bid!;
      const title = (btn as HTMLElement).dataset.title!;
      const amount = parseFloat((btn as HTMLElement).dataset.amount || '0');
      openMarkOtherPaidModal(bid, title, amount);
    });
  });

  // Mark Other Bill as Unpaid
  document.querySelectorAll('.btnToggleOtherUnpaid').forEach(btn => {
    btn.addEventListener('click', () => {
      const bid = (btn as HTMLElement).dataset.bid!;
      const billTitle = currentMonth.otherBills && currentMonth.otherBills[bid] ? currentMonth.otherBills[bid].title : bid;
      if (currentMonth.otherBills && currentMonth.otherBills[bid]) {
        currentMonth.otherBills[bid].isPaid = false;
        currentMonth.otherBills[bid].paidDate = undefined;
        currentMonth.otherBills[bid].paidNote = undefined;
        saveState();
        render();
        showToast(`Marked ${billTitle} as unpaid`, 'ℹ️');
      }
    });
  });

  // Add Expense button
  document.getElementById('btnAddExpense')?.addEventListener('click', () => {
    openAddExpenseModal();
  });

  // Delete Expense buttons
  document.querySelectorAll('.btnDeleteExpense').forEach(btn => {
    btn.addEventListener('click', () => {
      const expId = (btn as HTMLElement).dataset.id;
      currentMonth.commonExpenses = currentMonth.commonExpenses.filter(x => x.id !== expId);
      saveState();
      render();
    });
  });

  // Roommate Cash Payment
  document.querySelectorAll('.btnPayCash').forEach(btn => {
    btn.addEventListener('click', () => {
      const memberId = (btn as HTMLElement).dataset.id!;
      const memberName = (btn as HTMLElement).dataset.name!;
      const due = parseFloat((btn as HTMLElement).dataset.due || '0');
      openPaymentModal(memberId, memberName, due);
    });
  });

  // Member Ledger button
  document.querySelectorAll('.btnLedger').forEach(btn => {
    btn.addEventListener('click', () => {
      const memberId = (btn as HTMLElement).dataset.id!;
      const memberName = (btn as HTMLElement).dataset.name!;
      openLedgerModal(memberId, memberName);
    });
  });

  // WhatsApp Summary
  document.getElementById('btnCopyWhatsApp')?.addEventListener('click', () => {
    openWhatsAppModal();
  });

  // Next Month Rollover
  document.getElementById('btnNewMonth')?.addEventListener('click', () => {
    openNewMonthModal();
  });

  // Settings
  document.getElementById('btnSettings')?.addEventListener('click', () => {
    openSettingsModal();
  });

  // Sync Center & Disk Badge
  document.getElementById('btnOpenSyncModal')?.addEventListener('click', () => {
    openSyncModal();
  });
  document.getElementById('diskSyncBadge')?.addEventListener('click', () => {
    openSyncModal();
  });
  document.getElementById('cloudSyncBadge')?.addEventListener('click', () => {
    openSyncModal();
  });

  // Segmented View Mode Switcher
  document.getElementById('viewBtnDual')?.addEventListener('click', () => {
    state.side1ViewMode = 'dual';
    saveState();
    render();
  });
  document.getElementById('viewBtnTable')?.addEventListener('click', () => {
    state.side1ViewMode = 'table';
    saveState();
    render();
  });
  document.getElementById('viewBtnCards')?.addEventListener('click', () => {
    state.side1ViewMode = 'cards';
    saveState();
    render();
  });
}

// --- Modals ---
function openModal(contentHtml: string) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  if (!overlay || !content) return;
  content.innerHTML = contentHtml;
  overlay.classList.remove('hidden');

  overlay.onclick = (e) => {
    if (e.target === overlay) closeModal();
  };
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.classList.add('hidden');
}

// 1. Pay Landlord Modal (Supports Installments & Editable Landlord Due)
function openPayLandlordModal(suggestedAmount: number) {
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = state.months.find(m => m.id === state.currentMonthId)!;
  const calc = calculateMonth(currentMonth, state.members);
  const l = currentMonth.landlord;
  const distinctMonth = calc.landlordDistinctMonth;
  const initialDue = l.previousDue || 0;
  const alreadyPaid = calc.landlordTotalPaid;

  const computeTotals = (due: number, payAmt: number) => {
    const totalPayable = distinctMonth + due;
    const remainingDue = Math.max(0, totalPayable - alreadyPaid);
    const postPayRemaining = Math.max(0, totalPayable - alreadyPaid - payAmt);
    return { totalPayable, remainingDue, postPayRemaining };
  };

  const initialTotals = computeTotals(initialDue, suggestedAmount > 0 ? suggestedAmount : 0);

  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white text-lg shadow-[0_0_16px_rgba(245,158,11,0.35)]">
          🏠
        </div>
        <div>
          <h3 class="text-base font-black text-white flex items-center gap-2">
            Pay Landlord Cash Installment
          </h3>
          <p class="text-xs text-slate-400 font-medium">Rent, Gas, Lift, Water, Electricity & Past Due</p>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>
    <form id="payLandlordForm" class="mt-4 space-y-4">
      
      <!-- 📌 SECTION 1: LANDLORD BILL & DUE BREAKDOWN -->
      <div class="glass-panel-subtle p-4 border border-white/10 rounded-2xl shadow-sm text-xs space-y-2.5 bg-slate-950/60">
        <div>
          <div class="flex justify-between items-center text-slate-300 font-semibold">
            <span class="flex items-center gap-1.5">
              <span class="text-indigo-400">⭐</span> This Month Distinct Landlord Bill:
            </span>
            <strong class="text-sm font-black text-white tabular-nums">${distinctMonth.toLocaleString()} ৳</strong>
          </div>
          <div class="text-[10px] text-slate-400 font-medium mt-0.5">
            Rent (19,000) + Gas (1,080) + Lift (1,400) + Water (1,400) + Elec (${l.electricity.toLocaleString()}) • Wi-Fi, Khala & Moyla are separate
          </div>
        </div>

        <div class="flex justify-between items-center pt-2 border-t border-white/10">
          <div class="flex items-center gap-1.5">
            <span class="font-black text-amber-300">⚠️ Previous Landlord Due (বকেয়া):</span>
            <span class="text-[10px] text-slate-500 font-medium">(Editable as you want)</span>
          </div>
          <div class="flex items-center gap-1">
            <input type="number" id="modalLandlordPrevDue" value="${initialDue}" step="any" placeholder="0"
              class="glass-input w-24 text-right font-black text-amber-300 rounded-xl px-2.5 py-1 text-xs outline-none tabular-nums bg-slate-900/90 border-white/10" />
            <span class="text-xs font-bold text-slate-500">৳</span>
          </div>
        </div>

        <div class="border-t border-white/10 pt-2 flex justify-between items-center font-black text-white">
          <span>Total Payable to Landlord:</span>
          <span id="modalLandlordTotalPayable" class="text-sm font-black tabular-nums text-white">${initialTotals.totalPayable.toLocaleString()} ৳</span>
        </div>

        <div class="flex justify-between text-slate-400 text-[11px] font-semibold">
          <span>Already Paid so far:</span>
          <span class="text-emerald-400 font-bold tabular-nums">-${alreadyPaid.toLocaleString()} ৳ (${l.payments.length} installments)</span>
        </div>

        <div class="border-t border-white/10 pt-2 flex justify-between items-center font-black text-rose-400 text-sm">
          <span>Remaining Due to Landlord:</span>
          <span id="modalLandlordRemaining" class="tabular-nums font-black">${initialTotals.remainingDue.toLocaleString()} ৳</span>
        </div>
      </div>

      <!-- 📌 SECTION 2: CASH PAYMENT DETAILS -->
      <div>
        <label class="block text-xs font-extrabold text-slate-300 mb-1.5">Cash Amount to Pay Now (BDT):</label>
        <div class="relative flex items-center">
          <input type="number" id="landlordPayAmount" value="${suggestedAmount > 0 ? suggestedAmount : ''}" required placeholder="e.g. 20000" step="any"
            class="glass-input w-full text-xl font-black text-emerald-400 rounded-2xl px-4 py-3 outline-none tabular-nums bg-slate-900/90 border-white/10 focus:ring-4 focus:ring-emerald-500/20" />
          <span class="absolute right-4 text-sm font-black text-slate-500 pointer-events-none">BDT (৳)</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-400 mb-1">Payment Method:</label>
          <select id="landlordPayMethod" class="glass-input w-full rounded-xl px-3 py-2 text-xs font-bold text-slate-200 outline-none bg-slate-900/90 border-white/10">
            <option value="Cash" selected>Cash (ক্যাশ টাকা)</option>
            <option value="bKash">bKash</option>
            <option value="Bank">Bank Transfer</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-400 mb-1">Payment Date:</label>
          <input type="date" id="landlordPayDate" value="${today}" required
            class="glass-input w-full text-xs font-bold text-slate-200 rounded-xl px-3 py-2 outline-none bg-slate-900/90 border-white/10" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">Note (Optional):</label>
        <input type="text" id="landlordPayNote" placeholder="e.g. 1st installment, paid in cash hand-to-hand"
          class="glass-input w-full text-xs font-semibold text-slate-200 rounded-xl px-3.5 py-2 outline-none bg-slate-900/90 border-white/10" />
      </div>

      <!-- 📌 SECTION 3: LIVE POST-PAYMENT PREVIEW -->
      <div id="modalLandlordLiveBanner" class="p-3.5 rounded-2xl bg-slate-900/90 border border-white/10 text-xs text-slate-200 shadow-xs">
        <div class="font-extrabold flex items-center justify-between text-white">
          <span id="modalLandlordActionText">Paying ${(suggestedAmount || 0).toLocaleString()} ৳ to Landlord</span>
          <span class="text-sm">💵</span>
        </div>
        <div class="text-[11px] font-semibold text-amber-300 mt-1" id="modalLandlordPostRemaining">
          ${initialTotals.postPayRemaining <= 0 
            ? '✓ Landlord bill fully cleared!' 
            : `⏳ Remaining Due After This Payment: ${initialTotals.postPayRemaining.toLocaleString()} ৳ (will roll over to next month)`}
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button type="button" onclick="document.getElementById('modalOverlay').classList.add('hidden')"
          class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer">
          Cancel
        </button>
        <button type="submit"
          class="px-6 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.35)] active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer">
          <span>✓</span> Confirm Landlord Payment
        </button>
      </div>
    </form>
  `);

  const inputDueEl = document.getElementById('modalLandlordPrevDue') as HTMLInputElement;
  const inputAmtEl = document.getElementById('landlordPayAmount') as HTMLInputElement;

  const updateModalState = () => {
    const dueVal = parseFloat(inputDueEl.value) || 0;
    const payVal = parseFloat(inputAmtEl.value) || 0;
    const t = computeTotals(dueVal, payVal);

    const totalEl = document.getElementById('modalLandlordTotalPayable');
    const remEl = document.getElementById('modalLandlordRemaining');
    const actEl = document.getElementById('modalLandlordActionText');
    const postEl = document.getElementById('modalLandlordPostRemaining');

    if (totalEl) totalEl.textContent = `${t.totalPayable.toLocaleString()} ৳`;
    if (remEl) remEl.textContent = `${t.remainingDue.toLocaleString()} ৳`;
    if (actEl) actEl.textContent = `Paying ${payVal.toLocaleString()} ৳ to Landlord`;
    if (postEl) {
      postEl.textContent = t.postPayRemaining <= 0 
        ? '✓ Landlord bill fully cleared!' 
        : `⏳ Remaining Due After This Payment: ${t.postPayRemaining.toLocaleString()} ৳ (will roll over to next month)`;
    }
  };

  inputDueEl?.addEventListener('input', updateModalState);
  inputAmtEl?.addEventListener('input', updateModalState);

  document.getElementById('payLandlordForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const dueVal = parseFloat(inputDueEl.value);
    if (!isNaN(dueVal)) {
      l.previousDue = dueVal;
    }
    const amountVal = parseFloat(inputAmtEl.value);
    const methodVal = (document.getElementById('landlordPayMethod') as HTMLSelectElement).value;
    const dateVal = (document.getElementById('landlordPayDate') as HTMLInputElement).value;
    const noteVal = (document.getElementById('landlordPayNote') as HTMLInputElement).value;

    if (!l.payments) l.payments = [];
    l.payments.push({
      id: 'lpay-' + Date.now(),
      amount: amountVal,
      date: dateVal,
      method: methodVal,
      note: noteVal
    });

    saveState();
    closeModal();
    render();
    showToast(`Paid ${amountVal.toLocaleString()} ৳ to Landlord`, '🏠');
  });
}

// Landlord Installment History Modal
function openLandlordHistoryModal() {
  const currentMonth = state.months.find(m => m.id === state.currentMonthId)!;
  const l = currentMonth.landlord;
  const payments = l.payments || [];

  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white text-lg shadow-[0_0_16px_rgba(245,158,11,0.35)]">
          📜
        </div>
        <div>
          <h3 class="text-base font-black text-white">Landlord Installments History</h3>
          <p class="text-xs text-slate-400 font-medium">${currentMonth.name} • Landlord Package</p>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>
    <div class="mt-4 space-y-3">
      ${l.previousDueMention ? `
        <div class="p-3.5 bg-amber-950/40 border border-amber-500/30 rounded-2xl text-xs text-amber-200 shadow-xs">
          <strong class="font-bold text-amber-300">Previous Landlord Carryover:</strong><br/>
          <span class="font-medium text-slate-300">${l.previousDueMention}</span>
        </div>
      ` : ''}

      ${payments.length === 0 ? `
        <div class="text-center py-8 text-slate-500 text-xs font-medium">No payments recorded to the landlord yet this month.</div>
      ` : payments.map(p => `
        <div class="flex items-center justify-between p-3.5 rounded-2xl glass-card-interactive border border-white/10 bg-slate-900/40 text-xs">
          <div>
            <div class="font-black text-white text-sm tabular-nums">${p.amount.toLocaleString()} BDT</div>
            <div class="text-[11px] text-slate-400 font-semibold mt-0.5">${p.method} • ${p.date} ${p.note ? `• ${p.note}` : ''}</div>
          </div>
          <button class="btnDeleteLandlordPayment text-rose-300 hover:text-rose-200 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/40 text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer" data-pid="${p.id}">
            Delete
          </button>
        </div>
      `).join('')}
    </div>
    <div class="mt-6 flex justify-end">
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')"
        class="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition cursor-pointer">Close</button>
    </div>
  `);

  document.querySelectorAll('.btnDeleteLandlordPayment').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = (btn as HTMLElement).dataset.pid;
      l.payments = l.payments.filter(p => p.id !== pid);
      saveState();
      closeModal();
      render();
    });
  });
}

// 2. Mark Other Bill as Paid Modal
function openMarkOtherPaidModal(bid: string, title: string, amount: number) {
  const today = new Date().toISOString().split('T')[0];
  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-white text-lg shadow-[0_0_16px_rgba(16,185,129,0.35)]">
          🧾
        </div>
        <div>
          <h3 class="text-base font-black text-white">Pay Bill in Cash: ${title}</h3>
          <p class="text-xs text-slate-400 font-medium">Independent Flat Utility Bill</p>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>
    <form id="markOtherForm" class="mt-4 space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-400 mb-1">Cash Paid (BDT):</label>
          <input type="number" id="otherPayAmount" value="${amount}" required
            class="glass-input w-full text-base font-black text-white rounded-xl px-3.5 py-2.5 outline-none tabular-nums bg-slate-900/90 border-white/10 focus:ring-4 focus:ring-emerald-500/20" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-400 mb-1">Payment Date:</label>
          <input type="date" id="otherPayDate" value="${today}" required
            class="glass-input w-full text-xs font-bold text-slate-200 rounded-xl px-3 py-2.5 outline-none bg-slate-900/90 border-white/10" />
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button type="button" onclick="document.getElementById('modalOverlay').classList.add('hidden')"
          class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer">Cancel</button>
        <button type="submit"
          class="px-6 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.35)] active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer">
          <span>✓</span> Confirm Paid
        </button>
      </div>
    </form>
  `);

  document.getElementById('markOtherForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const amountVal = parseFloat((document.getElementById('otherPayAmount') as HTMLInputElement).value);
    const dateVal = (document.getElementById('otherPayDate') as HTMLInputElement).value;

    const currentMonth = state.months.find(m => m.id === state.currentMonthId)!;
    if (currentMonth.otherBills && currentMonth.otherBills[bid]) {
      currentMonth.otherBills[bid].isPaid = true;
      currentMonth.otherBills[bid].amount = isNaN(amountVal) ? amount : amountVal;
      currentMonth.otherBills[bid].paidDate = dateVal;
      currentMonth.otherBills[bid].paidMethod = 'Cash';
    }

    saveState();
    closeModal();
    render();
    showToast(`Marked ${title} as paid (${(isNaN(amountVal) ? amount : amountVal).toLocaleString()} ৳)`, '🧾');
  });
}

// 3. Roommate Payment Modal (Supports Installments & Editable Member Due)
function openPaymentModal(memberId: string, memberName: string, suggestedAmount?: number) {
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = state.months.find(m => m.id === state.currentMonthId)!;
  const calc = calculateMonth(currentMonth, state.members);
  const row = calc.rows.find(r => r.member.id === memberId)!;
  const rec = currentMonth.memberRecords[memberId] || { memberId, previousBalance: 0, payments: [] };

  const distinctMonth = row.distinctThisMonth;
  // in prevBalance: negative is due (+haveToPay), positive is advance (-haveToPay)
  const initialDue = rec.previousBalance < 0 ? Math.abs(rec.previousBalance) : (rec.previousBalance > 0 ? -rec.previousBalance : 0);
  const alreadyPaid = row.totalPaid;

  const computeTotals = (due: number, payAmt: number) => {
    const totalPayable = distinctMonth + due;
    const remainingDue = Math.max(0, totalPayable - alreadyPaid);
    const postPayRemaining = Math.max(0, totalPayable - alreadyPaid - payAmt);
    return { totalPayable, remainingDue, postPayRemaining };
  };

  const defaultPay = typeof suggestedAmount === 'number' && suggestedAmount > 0 
    ? suggestedAmount 
    : Math.max(0, (distinctMonth + initialDue) - alreadyPaid);
  const initialTotals = computeTotals(initialDue, defaultPay);

  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-white text-lg shadow-[0_0_16px_rgba(16,185,129,0.35)]">
          💵
        </div>
        <div>
          <h3 class="text-base font-black text-white flex items-center gap-2">
            Record Cash Payment: ${memberName}
          </h3>
          <div class="flex items-center gap-2 text-xs text-slate-400 font-medium mt-0.5">
            <span class="bg-slate-900 text-slate-300 border border-white/10 px-2 py-0.5 rounded-md text-[11px] font-bold">${row.member.roomLabel}</span>
            <span>• Base: ${row.member.baseRent.toLocaleString()} ৳</span>
          </div>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>

    <form id="paymentForm" class="mt-4 space-y-4">
      
      <!-- 📌 SECTION 1: DISTINCT BILL & DUE BREAKDOWN -->
      <div class="glass-panel-subtle p-4 border border-white/10 rounded-2xl shadow-sm text-xs space-y-2.5 bg-slate-950/60">
        <div class="flex items-center justify-between text-slate-300 font-semibold">
          <span class="flex items-center gap-1.5">
            <span class="text-indigo-400">⭐</span> This Month Living Bill (Distinct):
          </span>
          <span class="font-black text-sm text-indigo-300 tabular-nums">${distinctMonth.toLocaleString()} ৳</span>
        </div>

        <!-- SEPARATE DUE INPUT ROW -->
        <div class="flex items-center justify-between pt-2 border-t border-white/10">
          <div class="flex items-center gap-1.5">
            <span class="font-black text-rose-400">⚠️ Previous Due (বকেয়া):</span>
            <span class="text-[10px] text-slate-500 font-medium">(Input as you want)</span>
          </div>
          <div class="flex items-center gap-1">
            <input type="number" id="modalMemberDue" value="${initialDue}" step="any" placeholder="0"
              class="glass-input w-24 text-right font-black text-rose-300 rounded-xl px-2.5 py-1 text-xs outline-none tabular-nums bg-slate-900/90 border-white/10" />
            <span class="text-xs font-bold text-slate-500">৳</span>
          </div>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-white/10 font-black text-white">
          <span>Total Have To Pay:</span>
          <span id="modalTotalPayable" class="text-sm font-black tabular-nums text-white">${initialTotals.totalPayable.toLocaleString()} ৳</span>
        </div>

        <div class="flex items-center justify-between text-slate-400 text-[11px] font-semibold">
          <span>Already Paid so far:</span>
          <span class="text-emerald-400 font-bold tabular-nums">-${alreadyPaid.toLocaleString()} ৳ (${row.payments.length} installments)</span>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-white/10 text-rose-400 font-black text-sm">
          <span>Total Due to Collect (সর্বমোট বকেয়া):</span>
          <span id="modalRemainingDue" class="tabular-nums font-black text-base text-rose-400">${initialTotals.remainingDue.toLocaleString()} ৳</span>
        </div>
      </div>

      <!-- 📌 SECTION 2: CASH PAYMENT DETAILS -->
      <div>
        <label class="block text-xs font-extrabold text-slate-300 mb-1.5">Cash Amount Paid Now (BDT):</label>
        <div class="relative flex items-center">
          <input type="number" id="payAmount" value="${defaultPay > 0 ? defaultPay : ''}" required placeholder="e.g. 3000" step="any"
            class="glass-input w-full text-xl font-black text-emerald-400 rounded-2xl px-4 py-3 outline-none tabular-nums bg-slate-900/90 border-white/10 focus:ring-4 focus:ring-emerald-500/20" />
          <span class="absolute right-4 text-sm font-black text-slate-500 pointer-events-none">BDT (৳)</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-400 mb-1">Payment Method:</label>
          <select id="payMethod" class="glass-input w-full rounded-xl px-3 py-2 text-xs font-bold text-slate-200 outline-none bg-slate-900/90 border-white/10">
            <option value="Cash" selected>Cash (ক্যাশ টাকা)</option>
            <option value="bKash">bKash</option>
            <option value="Nagad">Nagad</option>
            <option value="Bank">Bank Transfer</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-400 mb-1">Payment Date:</label>
          <input type="date" id="payDate" value="${today}" required
            class="glass-input w-full text-xs font-bold text-slate-200 rounded-xl px-3 py-2 outline-none bg-slate-900/90 border-white/10" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">Note (Optional):</label>
        <input type="text" id="payNote" placeholder="e.g. 1st installment, paid in cash hand-to-hand"
          class="glass-input w-full text-xs font-semibold text-slate-200 rounded-xl px-3.5 py-2 outline-none bg-slate-900/90 border-white/10" />
      </div>

      <!-- 📌 SECTION 3: LIVE POST-PAYMENT PREVIEW -->
      <div id="modalLiveRemainingBanner" class="p-3.5 rounded-2xl bg-slate-900/90 border border-white/10 text-xs text-slate-200 shadow-xs">
        <div class="font-extrabold flex items-center justify-between text-white">
          <span id="modalLiveActionText">Paying ${(defaultPay || 0).toLocaleString()} ৳ in cash</span>
          <span class="text-sm">💵</span>
        </div>
        <div class="text-[11px] font-semibold text-amber-300 mt-1" id="modalLiveRemainingText">
          ${initialTotals.postPayRemaining <= 0 
            ? '✓ Full bill cleared! Total due: 0 ৳' 
            : `⏳ Total Due After This Payment: ${initialTotals.postPayRemaining.toLocaleString()} ৳ (will roll over to next month)`}
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button type="button" onclick="document.getElementById('modalOverlay').classList.add('hidden')"
          class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer">
          Cancel
        </button>
        <button type="submit"
          class="px-6 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.35)] active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer">
          <span>✓</span> Save Cash Payment
        </button>
      </div>
    </form>
  `);

  const inputDueEl = document.getElementById('modalMemberDue') as HTMLInputElement;
  const inputAmtEl = document.getElementById('payAmount') as HTMLInputElement;

  const updateModalState = () => {
    const dueVal = parseFloat(inputDueEl.value) || 0;
    const payVal = parseFloat(inputAmtEl.value) || 0;
    const t = computeTotals(dueVal, payVal);

    const totalEl = document.getElementById('modalTotalPayable');
    const remEl = document.getElementById('modalRemainingDue');
    const actEl = document.getElementById('modalLiveActionText');
    const postEl = document.getElementById('modalLiveRemainingText');

    if (totalEl) totalEl.textContent = `${t.totalPayable.toLocaleString()} ৳`;
    if (remEl) remEl.textContent = `${t.remainingDue.toLocaleString()} ৳`;
    if (actEl) actEl.textContent = `Paying ${payVal.toLocaleString()} ৳ in cash`;
    if (postEl) {
      postEl.textContent = t.postPayRemaining <= 0 
        ? '✓ Full bill cleared! Total due: 0 ৳' 
        : `⏳ Total Due After This Payment: ${t.postPayRemaining.toLocaleString()} ৳ (will roll over to next month)`;
    }
  };

  inputDueEl?.addEventListener('input', updateModalState);
  inputAmtEl?.addEventListener('input', updateModalState);

  document.getElementById('paymentForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const dueVal = parseFloat(inputDueEl.value);
    if (!currentMonth.memberRecords[memberId]) {
      currentMonth.memberRecords[memberId] = { memberId, previousBalance: 0, payments: [] };
    }
    if (!isNaN(dueVal)) {
      currentMonth.memberRecords[memberId].previousBalance = -dueVal;
    }

    const amount = parseFloat(inputAmtEl.value);
    const method = (document.getElementById('payMethod') as HTMLSelectElement).value;
    const date = (document.getElementById('payDate') as HTMLInputElement).value;
    const note = (document.getElementById('payNote') as HTMLInputElement).value;

    currentMonth.memberRecords[memberId].payments.push({
      id: 'pay-' + Date.now(),
      memberId,
      amount,
      method,
      date,
      note
    });

    saveState();
    closeModal();
    render();
    showToast(`Recorded ${amount.toLocaleString()} ৳ cash payment for ${memberName}`, '💵');
  });
}

// 4. Add Expense Modal
function openAddExpenseModal() {
  const today = new Date().toISOString().split('T')[0];
  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-lg shadow-[0_0_16px_rgba(99,102,241,0.35)]">
          🛒
        </div>
        <div>
          <h3 class="text-base font-black text-white">Add Flat Expense</h3>
          <p class="text-xs text-slate-400 font-medium">Divided equally among all 7 members</p>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>
    <form id="expenseForm" class="mt-4 space-y-4">
      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">Expense Title / Item:</label>
        <input type="text" id="expTitle" required placeholder="e.g. Harpic & Wheel, Water filter kit, Wifi router"
          class="glass-input w-full text-xs font-semibold text-slate-200 rounded-xl px-3.5 py-2.5 outline-none bg-slate-900/90 border-white/10" />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-400 mb-1">Amount (BDT):</label>
          <input type="number" id="expAmount" required min="1" step="any" placeholder="e.g. 160"
            class="glass-input w-full text-base font-black text-white rounded-xl px-3.5 py-2.5 outline-none tabular-nums bg-slate-900/90 border-white/10 focus:ring-4 focus:ring-indigo-500/20" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-400 mb-1">Who Paid for it?</label>
          <select id="expPaidBy" class="glass-input w-full rounded-xl px-3 py-2.5 text-xs font-bold text-slate-200 outline-none bg-slate-900/90 border-white/10">
            <option value="flat" selected>Mess Fund (Cash Out)</option>
            ${state.members.map(m => `<option value="${m.id}">${m.name} (Credit to his bill)</option>`).join('')}
          </select>
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">Date:</label>
        <input type="date" id="expDate" value="${today}"
          class="glass-input w-full text-xs font-bold text-slate-200 rounded-xl px-3 py-2 outline-none bg-slate-900/90 border-white/10" />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button type="button" onclick="document.getElementById('modalOverlay').classList.add('hidden')"
          class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer">Cancel</button>
        <button type="submit"
          class="px-6 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-[0_0_20px_rgba(99,102,241,0.35)] active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer">Add Expense</button>
      </div>
    </form>
  `);

  document.getElementById('expenseForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = (document.getElementById('expTitle') as HTMLInputElement).value;
    const amount = parseFloat((document.getElementById('expAmount') as HTMLInputElement).value);
    const paidBy = (document.getElementById('expPaidBy') as HTMLSelectElement).value;
    const date = (document.getElementById('expDate') as HTMLInputElement).value;

    const currentMonth = state.months.find(m => m.id === state.currentMonthId)!;
    currentMonth.commonExpenses.push({
      id: 'exp-' + Date.now(),
      title,
      amount,
      paidBy,
      date: date || new Date().toISOString().split('T')[0],
      method: 'Cash'
    });

    saveState();
    closeModal();
    render();
  });
}

// 5. Member Ledger Modal
function openLedgerModal(memberId: string, memberName: string) {
  const currentMonth = state.months.find(m => m.id === state.currentMonthId)!;
  const rec = currentMonth.memberRecords[memberId];
  const payments = rec ? rec.payments : [];

  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-500 to-indigo-600 flex items-center justify-center text-white text-lg shadow-[0_0_16px_rgba(99,102,241,0.35)]">
          📜
        </div>
        <div>
          <h3 class="text-base font-black text-white">Payment History: ${memberName}</h3>
          <p class="text-xs text-slate-400 font-medium">${currentMonth.name} Cash Installments</p>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>
    <div class="mt-4 space-y-3">
      ${rec && rec.previousBalanceMention ? `
        <div class="p-3.5 bg-amber-950/40 border border-amber-500/30 rounded-2xl text-xs text-amber-200 shadow-xs">
          <strong class="font-bold text-amber-300">Previous Month Carryover:</strong><br/>
          <span class="font-medium text-slate-300">${rec.previousBalanceMention}</span>
        </div>
      ` : ''}

      ${payments.length === 0 ? `
        <div class="text-center py-8 text-slate-500 text-xs font-medium">No direct payments logged for ${memberName} in this month yet.</div>
      ` : payments.map(p => `
        <div class="flex items-center justify-between p-3.5 rounded-2xl glass-card-interactive border border-white/10 bg-slate-900/40 text-xs">
          <div>
            <div class="font-black text-white text-sm tabular-nums">${p.amount.toLocaleString()} BDT</div>
            <div class="text-[11px] text-slate-400 font-semibold mt-0.5">${p.method} • ${p.date} ${p.note ? `• ${p.note}` : ''}</div>
          </div>
          <button class="btnDeletePayment text-rose-300 hover:text-rose-200 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/40 text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer" data-pid="${p.id}">
            Delete
          </button>
        </div>
      `).join('')}
    </div>
    <div class="mt-6 flex justify-end">
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')"
        class="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition cursor-pointer">Close</button>
    </div>
  `);

  document.querySelectorAll('.btnDeletePayment').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = (btn as HTMLElement).dataset.pid;
      if (rec) {
        rec.payments = rec.payments.filter(p => p.id !== pid);
        saveState();
        closeModal();
        render();
      }
    });
  });
}

// 6. WhatsApp Summary Modal (Strictly Distinct Separation)
function openWhatsAppModal() {
  const currentMonth = state.months.find(m => m.id === state.currentMonthId)!;
  const calc = calculateMonth(currentMonth, state.members);

  const lines = [
    `🏠 *বাসা ভাড়া ও মেস হিসাব - ${currentMonth.name}*`,
    `⭐ *চলতি মাসের মোট ফ্ল্যাট বিল (This Month Distinct):* ${calc.grandDistinctMonthBills.toLocaleString()} ৳`,
    `  • বাড়িওয়ালার বিল: ${calc.landlordDistinctMonth.toLocaleString()} ৳`,
    `  • ওয়াইফাই, বুয়া, ময়লা ও খরচ: ${(calc.otherBillsDistinctMonth + currentMonth.commonExpenses.reduce((s,e)=>s+e.amount,0)).toLocaleString()} ৳`,
    `⚡ বিদ্যুৎ: ${currentMonth.electricityUnits || 160} ইউনিট (${calc.unitsDiff > 0 ? `+${calc.unitsDiff} u = +${calc.elecAdjPerPerson} ৳/জন` : calc.unitsDiff < 0 ? `${calc.unitsDiff} u = ${calc.elecAdjPerPerson} ৳/জন` : 'স্বাভাবিক'})`,
    `----------------------------------------`,
    ...calc.rows.map(r => {
      const statusText = r.remaining === 0 
        ? `[পরিশোধ সম্পন্ন ✅]` 
        : r.remaining < 0 
          ? `[পরিশোধ: ${r.totalPaid.toLocaleString()} ৳ | বর্তমান বাকি: ${Math.abs(r.remaining).toLocaleString()} ৳ ⏳]` 
          : `[অগ্রিম: +${r.remaining.toLocaleString()} ৳]`;

      const breakdown = r.prevBal !== 0 
        ? `\n   • চলতি মাসের বিল: ${r.distinctThisMonth.toLocaleString()} ৳ | পূর্বের বাকি: ${r.prevBal < 0 ? `+${Math.abs(r.prevBal)} ৳` : `-${r.prevBal} ৳ adv`}`
        : `\n   • চলতি মাসের বিল: ${r.distinctThisMonth.toLocaleString()} ৳`;

      return `👤 *${r.member.name}*:${breakdown}\n   • মোট দিতে হবে: *${r.haveToPay.toLocaleString()} ৳* ${statusText}`;
    }),
    `----------------------------------------`,
    `💰 রুমমেটদের থেকে মোট জমা: ${calc.totalCashCollected.toLocaleString()} ৳ / ${calc.totalMemberPayable.toLocaleString()} ৳`,
    `⏳ মোট বাকি রয়েছে: ${calc.totalMemberDueRemaining.toLocaleString()} ৳`,
    `💵 ক্যাশ ইন হ্যান্ড (মেস ওয়ালেট): ${calc.cashInHand >= 0 ? '+' : ''}${calc.cashInHand.toLocaleString()} ৳`
  ].filter(Boolean).join('\n');

  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-green-600 flex items-center justify-center text-white text-lg shadow-[0_0_16px_rgba(16,185,129,0.35)]">
          💬
        </div>
        <div>
          <h3 class="text-base font-black text-white">WhatsApp Mess Summary</h3>
          <p class="text-xs text-slate-400 font-medium">হোয়াটসঅ্যাপ গ্রুপ মেসেজ ফরমেট</p>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>
    <div class="mt-4">
      <div class="bg-[#0b141a] border border-[#25D366]/30 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)] relative overflow-hidden">
        <div class="flex items-center justify-between pb-2 mb-2 border-b border-white/5 text-[11px] text-slate-400">
          <span class="flex items-center gap-1.5 text-[#25D366] font-bold">
            <span class="w-2 h-2 rounded-full bg-[#25D366] animate-pulse"></span> Group Chat Message Preview
          </span>
          <span class="font-mono text-[10px] text-slate-500">${currentMonth.name} Hisab</span>
        </div>
        <textarea id="whatsappText" rows="13" readonly
          class="w-full text-xs font-mono p-2.5 rounded-xl text-slate-200 bg-black/40 border border-white/5 outline-none select-all leading-relaxed focus:ring-1 focus:ring-[#25D366]/40">${lines}</textarea>
      </div>
      
      <div class="mt-4 flex justify-between items-center">
        <span id="copyNotice" class="text-xs font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-500/40 px-3.5 py-1.5 rounded-xl hidden shadow-[0_0_12px_rgba(16,185,129,0.2)]">
          ✓ Copied to clipboard! Ready to paste into WhatsApp
        </span>
        <button id="btnCopyText" class="ml-auto px-6 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.35)] active:scale-95 transition-all cursor-pointer">
          <span>📋</span> Copy Message
        </button>
      </div>
    </div>
  `);

  document.getElementById('btnCopyText')?.addEventListener('click', () => {
    const text = (document.getElementById('whatsappText') as HTMLTextAreaElement).value;
    navigator.clipboard.writeText(text).then(() => {
      const notice = document.getElementById('copyNotice');
      if (notice) notice.classList.remove('hidden');
      showToast('WhatsApp Hisab summary copied to clipboard!', '📋');
    });
  });
}

// 7. Next Month Rollover Modal (With Detailed Mentions & Both Landlord and Member Rollovers)
function openNewMonthModal() {
  const currentMonth = state.months.find(m => m.id === state.currentMonthId)!;
  const calc = calculateMonth(currentMonth, state.members);

  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-500 to-indigo-600 flex items-center justify-center text-white text-lg shadow-[0_0_16px_rgba(99,102,241,0.35)]">
          🗓️
        </div>
        <div>
          <h3 class="text-base font-black text-white">Start Next Month</h3>
          <p class="text-xs text-slate-400 font-medium">রোলওভার হিসাব ও অটোমেটিক বকেয়া স্থানান্তর</p>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>
    <div class="mt-4 space-y-4">
      <p class="text-xs text-slate-400 font-medium">
        Starting a new month will <strong class="text-slate-200">automatically carry over</strong> all unpaid dues and advances into next month with <strong class="text-slate-200">explicit date and reason mentions</strong>!
      </p>

      <!-- Landlord Rollover Preview -->
      <div class="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-xs shadow-xs">
        <div class="font-black text-amber-300 mb-1 flex items-center gap-1.5">
          <span>🏠</span> Landlord Carryover:
        </div>
        <div class="flex justify-between text-slate-300 font-semibold">
          <span>Landlord Remaining Due:</span>
          <strong class="${calc.landlordRemainingDue > 0 ? 'text-rose-400' : 'text-emerald-400'} font-black tabular-nums">
            ${calc.landlordRemainingDue > 0 ? `${calc.landlordRemainingDue.toLocaleString()} ৳ Unpaid` : '0 ৳ (Cleared)'}
          </strong>
        </div>
        ${calc.landlordRemainingDue > 0 ? `
          <div class="text-[11px] font-semibold text-amber-300 mt-1.5 pt-1.5 border-t border-amber-500/20">
            ↳ Will carry over to next month's landlord bill as: <strong>+${calc.landlordRemainingDue.toLocaleString()} ৳ Previous Due</strong>
          </div>
        ` : ''}
      </div>

      <!-- Roommates Rollover Preview -->
      <div class="glass-panel-subtle p-3.5 rounded-2xl border border-white/10 text-xs space-y-2 max-h-52 overflow-y-auto bg-slate-950/60">
        <div class="font-extrabold text-white mb-1">Roommates Carryover Preview:</div>
        ${calc.rows.map(r => {
          const mentionText = r.remaining < 0 
            ? `Due: ${Math.abs(r.remaining)} ৳ from ${currentMonth.name} (Billed ${r.haveToPay} ৳, Paid ${r.totalPaid} ৳ in ${r.payments.length} pmts)`
            : r.remaining > 0 
              ? `Advance: +${r.remaining} ৳ from ${currentMonth.name}`
              : `Cleared (0 ৳)`;

          return `
            <div class="p-2.5 rounded-xl glass-card-interactive border border-white/10 bg-slate-900/40">
              <div class="flex justify-between font-extrabold">
                <span class="text-slate-200">${r.member.name}:</span>
                <span class="${r.remaining < 0 ? 'text-rose-400' : r.remaining > 0 ? 'text-cyan-400' : 'text-emerald-400'} tabular-nums">
                  ${r.remaining < 0 ? `Owes ${Math.abs(r.remaining)} ৳ (Due)` : r.remaining > 0 ? `+${r.remaining} ৳ (Advance)` : `Cleared ✓`}
                </span>
              </div>
              <div class="text-[10px] text-slate-400 font-semibold mt-0.5">↳ ${mentionText}</div>
            </div>
          `;
        }).join('')}
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-400 mb-1">New Month Name:</label>
        <input type="text" id="newMonthName" placeholder="e.g. December 2026"
          class="glass-input w-full text-xs font-bold rounded-xl px-3.5 py-2.5 outline-none bg-slate-900/90 border-white/10 text-white focus:ring-4 focus:ring-brand-500/20" />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button type="button" onclick="document.getElementById('modalOverlay').classList.add('hidden')"
          class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer">Cancel</button>
        <button id="btnConfirmNewMonth"
          class="px-6 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.35)] active:scale-95 transition-all cursor-pointer">
          Create & Roll Over
        </button>
      </div>
    </div>
  `);

  document.getElementById('btnConfirmNewMonth')?.addEventListener('click', () => {
    const input = document.getElementById('newMonthName') as HTMLInputElement;
    const name = input.value.trim() || 'New Month';
    const newId = name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    // Build new records with carryover mentions
    const newRecords: Record<string, MemberMonthRecord> = {};
    for (const r of calc.rows) {
      let mention = '';
      if (r.remaining < 0) {
        mention = `Due: ${Math.abs(r.remaining)} ৳ from ${currentMonth.name} (Billed ${r.haveToPay} ৳, Paid ${r.totalPaid} ৳)`;
      } else if (r.remaining > 0) {
        mention = `Advance: +${r.remaining} ৳ from ${currentMonth.name}`;
      }

      newRecords[r.member.id] = {
        memberId: r.member.id,
        previousBalance: r.remaining, // carryover balance
        previousBalanceMention: mention || undefined,
        payments: []
      };
    }

    // Landlord Carryover
    const landlordRemaining = calc.landlordRemainingDue > 0 ? calc.landlordRemainingDue : 0;
    const landlordMention = landlordRemaining > 0 
      ? `Due ${landlordRemaining} ৳ from ${currentMonth.name} (Billed ${calc.landlordTotalPayable} ৳, Paid ${calc.landlordTotalPaid} ৳)`
      : undefined;

    const newLandlord: LandlordPackage = {
      rent: currentMonth.landlord.rent,
      gas: currentMonth.landlord.gas,
      lift: currentMonth.landlord.lift,
      water: currentMonth.landlord.water,
      electricity: currentMonth.landlord.electricity,
      previousDue: landlordRemaining,
      previousDueMention: landlordMention,
      payments: [] // reset installments for the new month
    };

    const newOtherBills: Record<string, IndependentBill> = {};
    if (currentMonth.otherBills) {
      Object.entries(currentMonth.otherBills).forEach(([k, v]) => {
        newOtherBills[k] = {
          ...v,
          isPaid: false,
          paidDate: undefined,
          paidNote: undefined
        };
      });
    }

    const newMonthData: MonthData = {
      id: newId,
      name: name,
      landlord: newLandlord,
      otherBills: Object.keys(newOtherBills).length > 0 ? newOtherBills : createDefaultOtherBills(),
      electricityUnits: 160,
      baselineUnits: 160,
      unitRate: currentMonth.unitRate || 10,
      commonExpenses: [],
      memberRecords: newRecords,
      isClosed: false
    };

    state.months.push(newMonthData);
    state.currentMonthId = newId;
    saveState();
    closeModal();
    render();
  });
}

// --- DATA BACKUP & GOOGLE SHEETS SYNC HELPERS ---

function downloadJsonBackup() {
  const jsonStr = JSON.stringify(state, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  a.href = url;
  a.download = `hisab-data-backup-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Downloaded hisab backup JSON file', '📥');
}

function restoreJsonBackup(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target?.result as string);
      if (parsed && parsed.months && Array.isArray(parsed.months)) {
        state = parsed;
        saveState();
        closeModal();
        render();
        showToast('Restored all hisab data successfully!', '✓');
      } else {
        alert('Invalid backup file. Must contain a valid months array.');
      }
    } catch (err: any) {
      alert('Failed to parse backup JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function copyTableForGoogleSheets(currentMonth: MonthData, calc: ReturnType<typeof calculateMonth>) {
  const headers = ['Member', 'Room', 'Base Rent (৳)', 'Living Share (৳)', 'This Month Bill (৳)', 'Previous Due (৳)', 'Total Have To Pay (৳)', 'Paid So Far (৳)', 'Current Due (৳)', 'Status'];
  const rows = calc.rows.map(r => [
    r.member.name,
    r.member.roomLabel,
    r.member.baseRent,
    r.perPersonDelta,
    r.distinctThisMonth,
    r.prevBal < 0 ? Math.abs(r.prevBal) : 0,
    r.haveToPay,
    r.totalPaid,
    r.remaining < 0 ? Math.abs(r.remaining) : 0,
    r.remaining === 0 ? 'Cleared' : r.remaining < 0 ? 'Due' : 'Advance'
  ]);

  const summaryRows = [
    [],
    ['--- SUMMARY ---', '', '', '', '', '', '', '', '', ''],
    ['Total Collection Needed', '', '', '', '', '', calc.totalMemberPayable, '', '', ''],
    ['Roommate Cash Collected', '', '', '', '', '', '', calc.totalCashCollected, '', ''],
    ['Total Dues Pending', '', '', '', '', '', '', '', calc.totalMemberDueRemaining, ''],
    ['Landlord Total Paid', '', '', '', '', '', '', calc.landlordTotalPaid, '', ''],
    ['Mess Drawer Cash Flow', '', '', '', '', '', '', calc.cashInHand, '', '']
  ];

  const tsv = [
    [`HISAB FLAT RENT & BILLS - ${currentMonth.name.toUpperCase()}`],
    [],
    headers.join('\t'),
    ...rows.map(row => row.join('\t')),
    ...summaryRows.map(row => row.join('\t'))
  ].join('\n');

  navigator.clipboard.writeText(tsv).then(() => {
    showToast('Copied! Open Google Sheets and press Ctrl+V', '📋');
  });
}

function downloadCsvForGoogleSheets(currentMonth: MonthData, calc: ReturnType<typeof calculateMonth>) {
  const headers = ['Member', 'Room', 'Base Rent', 'Living Share', 'This Month Bill', 'Previous Due', 'Total Have To Pay', 'Paid So Far', 'Current Due', 'Status'];
  const rows = calc.rows.map(r => [
    `"${r.member.name}"`,
    `"${r.member.roomLabel}"`,
    r.member.baseRent,
    r.perPersonDelta,
    r.distinctThisMonth,
    r.prevBal < 0 ? Math.abs(r.prevBal) : 0,
    r.haveToPay,
    r.totalPaid,
    r.remaining < 0 ? Math.abs(r.remaining) : 0,
    `"${r.remaining === 0 ? 'Cleared' : r.remaining < 0 ? 'Due' : 'Advance'}"`
  ]);

  const csv = [
    `"HISAB FLAT RENT & BILLS - ${currentMonth.name}"`,
    '',
    headers.join(','),
    ...rows.map(row => row.join(',')),
    '',
    `"Total Collection Needed",,,,,,${calc.totalMemberPayable}`,
    `"Roommate Cash Collected",,,,,,,${calc.totalCashCollected}`,
    `"Total Dues Pending",,,,,,,,${calc.totalMemberDueRemaining}`,
    `"Cash in Drawer Balance",,,,,,,${calc.cashInHand}`
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hisab-${currentMonth.id}-google-sheets.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Downloaded Google Sheets CSV file', '📄');
}

const APPS_SCRIPT_SNIPPET = `function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    sheet.clear();
    sheet.appendRow(["🏠 HISAB FLAT RENT & BILLS: " + data.monthName, "Synced: " + data.syncedAt]);
    sheet.appendRow([]);
    sheet.appendRow(["Member", "Room", "Base Rent (৳)", "Living Share (৳)", "This Month Bill (৳)", "Past Due (৳)", "Total To Pay (৳)", "Paid So Far (৳)", "Current Due (৳)", "Status"]);
    data.rows.forEach(function(r) {
      sheet.appendRow([r.name, r.room, r.baseRent, r.perPersonDelta, r.distinctTotal, r.pastDue, r.haveToPay, r.paid, r.currentDue, r.status]);
    });
    sheet.appendRow([]);
    sheet.appendRow(["--- FLAT SUMMARY ---", "", "", "", "", "", "", "", "", ""]);
    sheet.appendRow(["Total Collection Needed", "", "", "", "", "", data.summary.totalBilled, "", "", ""]);
    sheet.appendRow(["Roommate Cash Collected", "", "", "", "", "", "", data.summary.cashCollected, "", ""]);
    sheet.appendRow(["Total Roommate Dues Pending", "", "", "", "", "", "", "", data.summary.pendingDues, ""]);
    sheet.appendRow(["Landlord Paid", "", "", "", "", "", "", data.summary.landlordPaid, "", ""]);
    sheet.appendRow(["Drawer Cash Balance", "", "", "", "", "", "", data.summary.drawerBalance, "", ""]);
    return ContentService.createTextOutput(JSON.stringify({result: "success"})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({result: "error", error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}`;

async function syncToGoogleSheets(currentMonth: MonthData, calc: ReturnType<typeof calculateMonth>) {
  const url = state.googleSheetsSettings?.webhookUrl?.trim();
  if (!url) {
    showToast('Please enter your Google Apps Script Webhook URL first', '⚠️');
    return;
  }

  const payload = {
    monthName: currentMonth.name,
    syncedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }) + ' (BST)',
    summary: {
      totalBilled: calc.totalMemberPayable,
      cashCollected: calc.totalCashCollected,
      pendingDues: calc.totalMemberDueRemaining,
      landlordPaid: calc.landlordTotalPaid,
      drawerBalance: calc.cashInHand
    },
    rows: calc.rows.map(r => ({
      name: r.member.name,
      room: r.member.roomLabel,
      baseRent: r.member.baseRent,
      perPersonDelta: r.perPersonDelta,
      distinctTotal: r.distinctThisMonth,
      pastDue: r.prevBal < 0 ? Math.abs(r.prevBal) : 0,
      haveToPay: r.haveToPay,
      paid: r.totalPaid,
      currentDue: r.remaining < 0 ? Math.abs(r.remaining) : 0,
      status: r.remaining === 0 ? 'Cleared' : r.remaining < 0 ? 'Due' : 'Advance'
    }))
  };

  try {
    showToast('Sending data to Google Sheets...', '⏳');
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!state.googleSheetsSettings) state.googleSheetsSettings = {};
    state.googleSheetsSettings.lastSyncedAt = new Date().toLocaleTimeString();
    saveState();
    showToast('Sent data to Google Sheets webhook!', '📊');
    openSyncModal();
  } catch (err: any) {
    showToast('Sync error: ' + err.message, '❌');
  }
}

function parseFirebaseConfigInput(text: string): FirebaseConfig | null {
  try {
    const clean = text.trim();
    if (clean.startsWith('{') && clean.endsWith('}')) {
      const p = JSON.parse(clean);
      if (p.apiKey && (p.projectId || p.appId)) return p;
    }
  } catch (e) {}

  const extract = (key: string) => {
    const match = text.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
    return match ? match[1].trim() : '';
  };

  const apiKey = extract('apiKey');
  const authDomain = extract('authDomain');
  const projectId = extract('projectId') || 'hisab-c1864';
  const storageBucket = extract('storageBucket');
  const messagingSenderId = extract('messagingSenderId');
  const appId = extract('appId');

  if (apiKey && (projectId || appId)) {
    return {
      apiKey,
      authDomain: authDomain || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: storageBucket || `${projectId}.firebasestorage.app`,
      messagingSenderId,
      appId
    };
  }

  return null;
}

// 8. Sync & Backup Center Modal
function openSyncModal() {
  const currentMonth = state.months.find(m => m.id === state.currentMonthId)!;
  const calc = calculateMonth(currentMonth, state.members);
  const webhookUrl = state.googleSheetsSettings?.webhookUrl || '';
  const lastSync = state.googleSheetsSettings?.lastSyncedAt || 'Not yet synced';

  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-600 to-indigo-600 flex items-center justify-center text-white text-lg shadow-[0_0_20px_rgba(16,185,129,0.35)]">
          💾
        </div>
        <div>
          <h3 class="text-base font-black text-white flex items-center gap-2">
            Data Sync & Backup Center
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Auto-Saving Active</span>
          </h3>
          <p class="text-xs text-slate-400 font-medium">Auto-save to PC Disk • Google Sheets Webhook Sync • 1-Click JSON Backup</p>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>

    <!-- TABS -->
    <div class="mt-4 flex gap-2 border-b border-white/10 pb-3 flex-wrap">
      <button id="tabSyncDisk" class="px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-xs">
        🖥️ PC Disk & JSON Backup
      </button>
      <button id="tabSyncFirebase" class="px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer text-slate-400 hover:text-white hover:bg-white/5">
        ☁️ Firebase Real-Time Cloud
      </button>
      <button id="tabSyncSheets" class="px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer text-slate-400 hover:text-white hover:bg-white/5">
        📊 Google Sheets Sync
      </button>
    </div>

    <!-- PANE 1: PC DISK & JSON BACKUP -->
    <div id="paneSyncDisk" class="mt-4 space-y-4">
      
      <!-- Live Hard Drive Status Card -->
      <div class="p-4 rounded-2xl bg-slate-900/90 border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.1)] space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
            <span class="text-xs font-black text-white">Live Hard Drive Auto-Save Active</span>
          </div>
          <span class="text-[10px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-md">Real-time</span>
        </div>
        <p class="text-xs text-slate-300">
          Every payment recorded and bill edited automatically writes to your physical hard drive at:
        </p>
        <div class="bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-[11px] font-mono text-indigo-300 flex items-center justify-between">
          <span>F:\\Hisab\\hisab-data.json</span>
          <span class="text-[10px] text-slate-400">Offline Safe</span>
        </div>
        <p class="text-[11px] text-slate-400 leading-relaxed">
          ✓ Clearing browser history or cookies will <strong>never</strong> erase your accounts.<br/>
          ✓ Open on your phone via home Wi-Fi to view or edit the exact same file.
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <button id="btnDownloadJson" class="p-3 rounded-2xl glass-card-interactive border border-white/10 bg-slate-900/60 hover:bg-slate-800 text-left transition flex items-center gap-3 cursor-pointer">
          <div class="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-lg border border-indigo-500/30">
            📥
          </div>
          <div>
            <div class="text-xs font-black text-white">Download Backup File</div>
            <div class="text-[10px] text-slate-400">Save a .json snapshot to your device</div>
          </div>
        </button>

        <button id="btnTriggerRestoreJson" class="p-3 rounded-2xl glass-card-interactive border border-white/10 bg-slate-900/60 hover:bg-slate-800 text-left transition flex items-center gap-3 cursor-pointer">
          <div class="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center text-lg border border-purple-500/30">
            📤
          </div>
          <div>
            <div class="text-xs font-black text-white">Restore from Backup</div>
            <div class="text-[10px] text-slate-400">Select any hisab-backup.json file</div>
          </div>
        </button>
        <input type="file" id="inputRestoreFile" accept=".json" class="hidden" />
      </div>

      <div class="flex justify-end pt-2">
        <button id="btnForceSaveDisk" class="px-4 py-2 rounded-xl text-xs font-extrabold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition flex items-center gap-1.5 cursor-pointer">
          <span>💾</span> Force Save to PC Now
        </button>
      </div>

    </div>

    <!-- PANE 2: FIREBASE REAL-TIME CLOUD -->
    <div id="paneSyncFirebase" class="mt-4 space-y-4 hidden">

      <!-- Status Card -->
      <div class="p-4 rounded-2xl bg-slate-900/90 border ${state.firebaseConfig ? 'border-sky-500/30 shadow-[0_0_20px_rgba(56,189,248,0.15)]' : 'border-white/10'} space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full ${state.firebaseConfig ? 'bg-sky-400 animate-pulse shadow-[0_0_8px_rgba(56,189,248,0.8)]' : 'bg-slate-500'}"></span>
            <span class="text-xs font-black text-white">
              ${state.firebaseConfig ? 'Connected to hisab-c1864 (Real-Time Cloud Active)' : 'Firebase Cloud Sync (Not Connected Yet)'}
            </span>
          </div>
          <span class="text-[10px] font-bold ${state.firebaseConfig ? 'text-sky-300 bg-sky-950/80 border-sky-500/40' : 'text-slate-400 bg-slate-800'} border px-2 py-0.5 rounded-md">
            ${state.firebaseConfig ? 'Live Two-Way Sync' : 'Offline Mode'}
          </span>
        </div>
        <p class="text-xs text-slate-300">
          ${state.firebaseConfig 
            ? 'Any payment recorded or bill edited on your phone or laptop syncs instantly across all connected screens in real time.' 
            : 'Connect your Firebase project to auto-sync your flat ledger across your phone, laptop, and roommates.'}
        </p>
      </div>

      <!-- Firebase Config Input Box -->
      <div class="p-4 rounded-2xl bg-slate-900/90 border border-white/10 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-black text-white flex items-center gap-1.5">
            <span>⚙️</span> Paste your Firebase Config:
          </span>
          <a href="https://console.firebase.google.com/project/hisab-c1864/settings/general" target="_blank" rel="noopener noreferrer"
            class="text-[11px] font-bold text-sky-400 hover:text-sky-300 underline flex items-center gap-1">
            <span>🔗</span> Open hisab-c1864 in Firebase Console ↗
          </a>
        </div>
        <p class="text-[11px] text-slate-400">
          In Firebase Console $\to$ <strong>Project settings</strong> $\to$ Scroll down to <strong>Your apps</strong> $\to$ Click Web icon <code>&lt;/&gt;</code> and copy the <code>firebaseConfig</code> object:
        </p>
        <textarea id="inputFirebaseConfigText" rows="6" placeholder='const firebaseConfig = {&#10;  apiKey: "AIzaSy...",&#10;  authDomain: "hisab-c1864.firebaseapp.com",&#10;  projectId: "hisab-c1864",&#10;  storageBucket: "hisab-c1864.firebasestorage.app",&#10;  messagingSenderId: "...",&#10;  appId: "1:...:web:..."&#10;};'
          class="glass-input w-full text-xs font-mono p-3 rounded-xl bg-black/50 border-white/10 text-white outline-none focus:ring-2 focus:ring-sky-500/50">${state.firebaseConfig ? JSON.stringify(state.firebaseConfig, null, 2) : ''}</textarea>

        <div class="flex items-center justify-between pt-1">
          ${state.firebaseConfig ? `
            <button id="btnDisconnectFirebase" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-500/30 transition cursor-pointer">
              Disconnect Cloud
            </button>
          ` : '<span></span>'}
          <button id="btnConnectFirebase" class="px-5 py-2 rounded-xl text-xs font-extrabold bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-[0_0_20px_rgba(56,189,248,0.35)] active:scale-95 transition flex items-center gap-1.5 cursor-pointer">
            <span>🚀</span> Save & Connect Firebase Cloud
          </button>
        </div>
      </div>

    </div>

    <!-- PANE 3: GOOGLE SHEETS LIVE SYNC & EXPORT -->
    <div id="paneSyncSheets" class="mt-4 space-y-4 hidden">

      <!-- Webhook URL Card -->
      <div class="p-4 rounded-2xl bg-slate-900/90 border border-white/10 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-black text-white flex items-center gap-1.5">
            <span>🔗</span> Google Apps Script Webhook URL:
          </span>
          <span class="text-[10px] text-slate-400">Last Synced: <strong class="text-emerald-400">${lastSync}</strong></span>
        </div>
        <input type="url" id="inputWebhookUrl" value="${webhookUrl}" placeholder="https://script.google.com/macros/s/.../exec"
          class="glass-input w-full text-xs font-mono px-3.5 py-2.5 rounded-xl bg-black/50 border-white/10 text-white outline-none focus:ring-2 focus:ring-emerald-500/50" />
        
        <div class="flex items-center justify-between pt-1">
          <button id="btnSaveWebhookUrl" class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 transition cursor-pointer">
            Save Webhook URL
          </button>
          <button id="btnLiveSyncSheets" class="px-5 py-2 rounded-xl text-xs font-extrabold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.35)] active:scale-95 transition flex items-center gap-1.5 cursor-pointer">
            <span>🚀</span> Sync to Google Sheets Now
          </button>
        </div>
      </div>

      <!-- Quick 1-Click Clipboard & CSV Export -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button id="btnCopyForSheets" class="p-3 rounded-2xl glass-card-interactive border border-white/10 bg-slate-900/60 hover:bg-slate-800 text-left transition flex items-center gap-3 cursor-pointer">
          <div class="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-lg border border-emerald-500/30">
            📋
          </div>
          <div>
            <div class="text-xs font-black text-white">Copy for Google Sheets</div>
            <div class="text-[10px] text-slate-400">Tabular format ready for Ctrl+V paste</div>
          </div>
        </button>

        <button id="btnDownloadCsv" class="p-3 rounded-2xl glass-card-interactive border border-white/10 bg-slate-900/60 hover:bg-slate-800 text-left transition flex items-center gap-3 cursor-pointer">
          <div class="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center text-lg border border-teal-500/30">
            📄
          </div>
          <div>
            <div class="text-xs font-black text-white">Download CSV Sheet</div>
            <div class="text-[10px] text-slate-400">Formatted spreadsheet table</div>
          </div>
        </button>
      </div>

      <!-- Collapsible Setup Guide -->
      <div class="p-3.5 rounded-2xl bg-black/40 border border-white/10 text-xs space-y-2">
        <div class="flex items-center justify-between text-slate-300 font-bold">
          <span>⚡ How to set up Google Sheets live sync (1 minute):</span>
          <button id="btnCopyScriptCode" class="text-[10px] font-black text-emerald-400 hover:text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer">
            <span>📋</span> Copy Apps Script Code
          </button>
        </div>
        <ol class="list-decimal list-inside text-[11px] text-slate-400 space-y-1 leading-relaxed pl-1">
          <li>Create a blank Google Sheet, click <strong>Extensions > Apps Script</strong>.</li>
          <li>Click the button above to copy the script, paste it in, and save.</li>
          <li>Click <strong>Deploy > New Deployment</strong>, choose <strong>Web App</strong>, set <em>"Who has access"</em> to <strong>Anyone</strong>, then copy the web app URL into the field above!</li>
        </ol>
      </div>

    </div>
  `);

  // Tab switching
  const tabDisk = document.getElementById('tabSyncDisk');
  const tabFirebase = document.getElementById('tabSyncFirebase');
  const tabSheets = document.getElementById('tabSyncSheets');
  const paneDisk = document.getElementById('paneSyncDisk');
  const paneFirebase = document.getElementById('paneSyncFirebase');
  const paneSheets = document.getElementById('paneSyncSheets');

  const showTab = (tab: 'disk' | 'firebase' | 'sheets') => {
    tabDisk?.setAttribute('class', 'px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer text-slate-400 hover:text-white hover:bg-white/5');
    tabFirebase?.setAttribute('class', 'px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer text-slate-400 hover:text-white hover:bg-white/5');
    tabSheets?.setAttribute('class', 'px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer text-slate-400 hover:text-white hover:bg-white/5');

    paneDisk?.classList.add('hidden');
    paneFirebase?.classList.add('hidden');
    paneSheets?.classList.add('hidden');

    if (tab === 'disk') {
      tabDisk?.setAttribute('class', 'px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-xs');
      paneDisk?.classList.remove('hidden');
    } else if (tab === 'firebase') {
      tabFirebase?.setAttribute('class', 'px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-xs');
      paneFirebase?.classList.remove('hidden');
    } else if (tab === 'sheets') {
      tabSheets?.setAttribute('class', 'px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-xs');
      paneSheets?.classList.remove('hidden');
    }
  };

  tabDisk?.addEventListener('click', () => showTab('disk'));
  tabFirebase?.addEventListener('click', () => showTab('firebase'));
  tabSheets?.addEventListener('click', () => showTab('sheets'));

  // Firebase Actions
  document.getElementById('btnConnectFirebase')?.addEventListener('click', () => {
    const raw = (document.getElementById('inputFirebaseConfigText') as HTMLTextAreaElement).value;
    const parsed = parseFirebaseConfigInput(raw);
    if (!parsed) {
      alert('Could not parse Firebase configuration. Please make sure to copy the entire firebaseConfig object from Firebase console.');
      return;
    }
    const success = setupFirebase(parsed);
    if (success) {
      state.firebaseConfig = parsed;
      saveState();
      showToast('Connected to Firebase Firestore in real-time!', '☁️');
      openSyncModal();
    } else {
      alert('Failed to connect to Firebase. Please check your apiKey and projectId.');
    }
  });

  document.getElementById('btnDisconnectFirebase')?.addEventListener('click', () => {
    state.firebaseConfig = undefined;
    saveState();
    showToast('Disconnected from Firebase Cloud', 'ℹ️');
    openSyncModal();
  });

  // Disk Actions
  document.getElementById('btnDownloadJson')?.addEventListener('click', () => {
    downloadJsonBackup();
  });

  document.getElementById('btnTriggerRestoreJson')?.addEventListener('click', () => {
    document.getElementById('inputRestoreFile')?.click();
  });

  document.getElementById('inputRestoreFile')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) restoreJsonBackup(file);
  });

  document.getElementById('btnForceSaveDisk')?.addEventListener('click', () => {
    saveState();
    showToast('Saved current hisab state to PC hard drive!', '💾');
  });

  // Google Sheets Actions
  document.getElementById('btnSaveWebhookUrl')?.addEventListener('click', () => {
    const url = (document.getElementById('inputWebhookUrl') as HTMLInputElement).value;
    if (!state.googleSheetsSettings) state.googleSheetsSettings = {};
    state.googleSheetsSettings.webhookUrl = url;
    saveState();
    showToast('Google Sheets Webhook URL saved!', '✓');
  });

  document.getElementById('btnLiveSyncSheets')?.addEventListener('click', () => {
    syncToGoogleSheets(currentMonth, calc);
  });

  document.getElementById('btnCopyForSheets')?.addEventListener('click', () => {
    copyTableForGoogleSheets(currentMonth, calc);
  });

  document.getElementById('btnDownloadCsv')?.addEventListener('click', () => {
    downloadCsvForGoogleSheets(currentMonth, calc);
  });

  document.getElementById('btnCopyScriptCode')?.addEventListener('click', () => {
    navigator.clipboard.writeText(APPS_SCRIPT_SNIPPET).then(() => {
      showToast('Google Apps Script code copied to clipboard!', '📋');
    });
  });
}

// 9. Settings Modal
function openSettingsModal() {
  openModal(`
    <div class="flex items-center justify-between pb-4 border-b border-white/10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-slate-700 to-slate-900 flex items-center justify-center text-white text-lg shadow-[0_0_16px_rgba(255,255,255,0.1)] border border-white/10">
          ⚙️
        </div>
        <div>
          <h3 class="text-base font-black text-white">Flat Settings</h3>
          <p class="text-xs text-slate-400 font-medium">Standard 26,880 ৳ Base Rents & Data Controls</p>
        </div>
      </div>
      <button onclick="document.getElementById('modalOverlay').classList.add('hidden')" 
        class="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer">✕</button>
    </div>
    <div class="mt-4 space-y-4">
      <div>
        <h4 class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Member Base Rents</h4>
        <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
          ${state.members.map(m => `
            <div class="flex items-center justify-between gap-3 p-3 rounded-2xl glass-card-interactive border border-white/10 bg-slate-900/40 text-xs">
              <div>
                <span class="font-extrabold text-white">${m.name}</span>
                <span class="text-slate-400 ml-2 text-[11px] font-medium">${m.roomLabel}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <input type="number" class="inputMemberBase glass-input text-right font-black w-24 px-2.5 py-1 rounded-xl text-xs outline-none tabular-nums bg-slate-900/90 border-white/10 text-white"
                  data-mid="${m.id}" value="${m.baseRent}" />
                <span class="font-bold text-slate-500 text-xs">৳</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Sync Center Shortcut in Settings -->
      <div class="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <span class="text-xl">💾</span>
          <div>
            <div class="text-xs font-black text-white">Data Sync & Backup Center</div>
            <div class="text-[10px] text-slate-400">PC disk auto-save, Google Sheets sync, and JSON backup</div>
          </div>
        </div>
        <button type="button" id="btnSettingsOpenSync" class="px-3.5 py-1.5 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs cursor-pointer">
          Open Sync
        </button>
      </div>

      <div class="pt-3 border-t border-white/10 flex justify-between items-center">
        <button id="btnResetData" class="text-xs font-bold text-rose-400 hover:text-rose-300 transition cursor-pointer">
          Reset to Initial Sheets Data
        </button>
        <button id="btnSaveSettings" class="px-6 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.35)] active:scale-95 transition-all cursor-pointer">
          Save Settings
        </button>
      </div>
    </div>
  `);

  document.getElementById('btnSettingsOpenSync')?.addEventListener('click', () => {
    closeModal();
    openSyncModal();
  });

  document.getElementById('btnSaveSettings')?.addEventListener('click', () => {
    document.querySelectorAll('.inputMemberBase').forEach(input => {
      const mid = (input as HTMLElement).dataset.mid;
      const val = parseFloat((input as HTMLInputElement).value);
      const member = state.members.find(m => m.id === mid);
      if (member && !isNaN(val)) member.baseRent = val;
    });

    saveState();
    closeModal();
    render();
  });

  document.getElementById('btnResetData')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all data back to the original Google Sheet history?')) {
      localStorage.removeItem('basa_vara_hisab_state_v6');
      localStorage.removeItem('basa_vara_hisab_state_v5');
      state = initializeState();
      closeModal();
      render();
    }
  });
}

// --- Input Field Protection (Only Type Input, No Mouse Wheel or Arrow Key Scrolling) ---
// 1. Prevent mouse wheel from incrementing/decrementing number inputs
document.addEventListener('wheel', (e) => {
  const target = e.target;
  if (target instanceof HTMLInputElement && target.type === 'number') {
    e.preventDefault();
    target.blur();
  }
  const activeEl = document.activeElement;
  if (activeEl instanceof HTMLInputElement && activeEl.type === 'number') {
    if (e.target === activeEl) {
      e.preventDefault();
    }
    activeEl.blur();
  }
}, { passive: false });

// 2. Prevent ArrowUp & ArrowDown from scrolling numbers (type digits only)
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'number') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
    }
  }
});

// Initial Render & Disk Sync on Boot
render();
syncFromDiskOnBoot();
