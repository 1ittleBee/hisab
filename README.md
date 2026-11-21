# Basa Vara & Mess Hisab (বাসা ভাড়া ও মেস হিসাব)

A complete **Multi-Installment Cash Management & Mess Accounting Engine** tailored specifically for your 7-member flat in Dhaka.

---

## 📑 2 Distinct Pages / Views

The application is split into **two dedicated, independent pages** accessible from the top navigation bar:

### 1. 📋 Side 1: Roommate Collections (Cash In)
- **4 Vital Stat Cards**:
  - Total Collection Needed (`This Month Distinct` + `Past Arrears`)
  - Roommate Cash In (`% Received` progress bar & pending dues)
  - Total Roommate Dues Pending
  - Mess Wallet (`Cash in Hand`)
- **💳 Dedicated Previous Dues & Arrears Manager Section (NEW)**:
  - Separate card block above the table with **7 individual editable `<input>` fields** for each member's past due or advance credit.
  - Optional mention/note input (e.g. `Due from Nov: paid 3000 of 3300 on 12/11`).
  - You can input whatever due amount you want at any time!
- **Roommate Collections Table**:
  - **Member Name & Room Type**
  - **Base Rent** (Single: 4,050 ৳, Medium: 3,700 ৳, Shared: 3,300 ৳)
  - **Bills Adj (±)**: Dynamic distribution of utility changes
  - **⭐ This Month (Distinct)**: Pure, unpolluted monthly living charge
  - **⚠️ Previous Due (বকেয়া)**: **In-table direct editable `<input>` field** with quick-edit capability and carryover note.
  - **Total Have To Pay**: $\text{This Month (Distinct)} + \text{Inputted Due} - \text{Advance}$
  - **Cash Received**: Sum of all cash installments paid this month with breakdown
  - **Remaining Due / Advance**: Live status badge (Cleared, Unpaid Due, or Advance Credit)
  - **Actions**:
    - **`[+ Pay]`**: Opens redesigned 3-section Payment Modal with separate Bill vs Due breakdown!
    - **`[📜 History]`**: Inspect payment installment history.

---

### 2. 🏠 Side 2: Flat Bills & Landlord Payouts (Cash Out)
- **4 Vital Stat Cards**:
  - Total Flat Bills Payable (`Landlord Total` + `Utilities` + `Supplies`)
  - Total Bills Paid Out (`% Cleared` progress bar)
  - Remaining Bills Unpaid
  - Mess Wallet (`Cash in Hand`)
- **Dynamic Cost Breakdown**:
  - Meter reading inputs (`Electricity Units`, `Unit Rate ৳/unit`)
  - Live per-person utility adjustment ($\pm \text{BDT}$)
- **Landlord Package (Single Section & Single Payout Status)**:
  - 6 Sub-Items Grid:
    1. House Rent (`19,000 ৳`) — Input
    2. Gas (`1,080 ৳`) — Input
    3. Lift (`1,400 ৳` / 200×7) — Input
    4. Water (`1,400 ৳` / 200×7) — Input
    5. Electricity (`2,000 ৳ \pm \text{meter diff}`) — Input & tuning
    6. **⚠️ Previous Landlord Due (NEW)** — **Dedicated input field** to input any past landlord due you want, plus note!
  - **Record Landlord Cash Payout**: Support for partial payouts (e.g. pay 20,000 ৳ now out of 24,880 ৳, keep 4,880 ৳ as due) with date & note logging
  - Installment history list
- **Independent Utility Bills**:
  - Wi-Fi Bill (`800 ৳`), Cleaning Lady (`1,000 ৳`), Moyla (`200 ৳`)
  - Date recorded cash payout button for each vendor
- **Common Flat Expenses**:
  - Harpic, water filters, repair items with out-of-pocket reimbursement tracking

---

### 💵 Redesigned "Record Cash Payment" Modal
The payment modal is split into **3 clear sections**:
1. **Section 1: Distinct Bill & Due Breakdown**:
   - `⭐ This Month Living Bill (Distinct)` (e.g. 4,050 ৳)
   - `⚠️ Previous Due (বকেয়া)` (**Editable `<input>` box** so you can adjust due as you want directly in the modal!)
   - `Total Have To Pay`
   - `Already Paid so far`
   - `Remaining Due to Collect`
2. **Section 2: Cash Payment Details**:
   - `Cash Amount Paid Now (BDT)` input field
   - Payment Method (Cash, bKash, Nagad, Bank)
   - Date & Note
3. **Section 3: Live Post-Payment Preview**:
   - Real-time calculation showing: `Paying X ৳ now -> Remaining due after this payment: Y ৳ (will roll over to next month)`.

---

## ⚡ Core Philosophy: Strictly Distinct Monthly Living Bills
- **`⭐ This Month (Distinct)`**: The pure cost of living in the current month alone.
- **`Previous Due`**: Dedicated separate input layer with explicit dates and notes.
- **`Total Have To Pay`**: $\text{This Month (Distinct)} + \text{Inputted Due} - \text{Advance}$.

---

## 💵 Mess Wallet & Cash in Hand
$$\text{Cash in Hand} = \sum(\text{All Cash Collected from Roommates}) - \sum(\text{All Installments Paid to Landlord \& Bills})$$
- Tracks the physical cash sitting in your mess drawer/wallet in real-time.

---

## 📅 Chronological Activity Log
- Appears at the bottom of both pages.
- Itemizes every cash collection and bill payout by timestamp.

---

## 🚀 How to Run the Website

Double-click:
📁 **`F:\Hisab\run-app.bat`**

Or open in your browser:
🌐 **`http://localhost:5173`**
