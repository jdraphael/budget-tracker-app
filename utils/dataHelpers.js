// utils/dataHelpers.js
export function parseCSV(text) {
    if (!text) return [];
    // split on both LF and CRLF and remove any surrounding whitespace
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
    if (!lines.length) return [];
    // trim headers and remove BOM if present
    const headers = lines[0].split(',').map(h => h.trim().replace(/^\uFEFF/, ''));
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const obj = {};
        headers.forEach((header, index) => {
            let raw = values[index] !== undefined ? values[index].trim() : '';
            // convert numeric-looking fields to numbers where appropriate
            if (/amount|utilization/i.test(header) && raw !== '') {
                const num = Number(raw);
                obj[header] = isNaN(num) ? raw : num;
            } else {
                obj[header] = raw;
            }
        });
        data.push(obj);
    }
    return data;
}

export function calculateTotals(data) {
    const totalIncome = data.income.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
    const totalExpenses = data.transactions.filter(t => parseFloat(t.amount) < 0).reduce((sum, t) => sum + Math.abs(parseFloat(t.amount || 0)), 0);
    const netAmount = totalIncome - totalExpenses;
    const budgetUtilization = data.budgets.length ? (data.budgets.reduce((sum, b) => sum + parseFloat(b.utilization || 0), 0) / data.budgets.length).toFixed(0) : 0;
    return { totalIncome, totalExpenses, netAmount, budgetUtilization };
}
