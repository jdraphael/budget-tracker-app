// utils/dataHelpers.js
export function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',');
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = values[index];
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
