// Configuration
const CONFIG = {
    // AIRTABLE_TOKEN: 'patgXQiT2uTEngx6b.6f0ae131257d5b0980b57ac57461256a8b3afd4e6143e806b4ce9ddff7ed64de',
    // BASE_ID: 'appxXphBWtzBPDwrW',
    TABLE_NAME: 'Tracket Database',
    REVENUE_TABLE_NAME: 'EBR',
    PROJECTS_TABLE_NAME: 'Projects',
    COSTING_TABLE_NAME: 'Job Costing'
};

// Global variables
let allRecords = [];
let revenueData = [];
let projectsData = [];
let costingData = [];
let charts = {};
let currentFilters = {
    weekly: { employee: 'all', team: 'all', week: 'last' },
    monthly: { employee: 'all', team: 'all', month: 'last', year: 'current' },
    overall: { employee: 'all', team: 'all', year: 'all', month: 'all', dateFrom: '', dateTo: '' },
    '90days': { employee: 'all', team: 'all', dateFrom: '', dateTo: '' }
};

// Fetch all records from Airtable
async function fetchAllRecords(tableName) {
    const records = [];
    let offset = null;

    try {
        do {
            let url = `https://api.airtable.com/v0/${CONFIG.BASE_ID}/${encodeURIComponent(tableName)}?pageSize=100`;
            if (offset) url += `&offset=${offset}`;

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_TOKEN}` }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`API Error ${response.status}: ${errorData.error?.message || 'Failed to fetch data'}`);
            }

            const result = await response.json();
            records.push(...result.records);
            offset = result.offset;

            if (offset) await new Promise(r => setTimeout(r, 200));
        } while (offset);

        console.log(`✅ Fetched ${records.length} records from ${tableName}`);
        return records;

    } catch (error) {
        console.error('Error fetching records:', error);
        throw error;
    }
}

// Get week number
function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Get week key
function getWeekKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-W${String(getWeekNumber(d)).padStart(2, '0')}`;
}

// Get start of week
function getStartOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(d.setDate(diff));
    startOfWeek.setHours(0, 0, 0, 0);
    return startOfWeek;
}

// Get end of week
function getEndOfWeek(date) {
    const start = getStartOfWeek(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
}

// Filter records by period and filters
function filterRecordsByPeriod(records, period, filters) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const filtered = records.filter(record => {
        const fields = record.fields;
        const dateStr = fields['Worklog Date'];
        if (!dateStr) return false;

        const date = new Date(dateStr);

        let inPeriod = false;
        if (period === 'weekly') {
            if (filters.week === 'last') {
                const lastWeekDate = new Date(now);
                lastWeekDate.setDate(lastWeekDate.getDate() - 7);
                const lastWeekStart = getStartOfWeek(lastWeekDate);
                const lastWeekEnd = getEndOfWeek(lastWeekDate);
                const recordDate = new Date(dateStr);
                recordDate.setHours(0, 0, 0, 0);
                inPeriod = recordDate >= lastWeekStart && recordDate <= lastWeekEnd;
            } else if (filters.week === 'current') {
                const currentWeekStart = getStartOfWeek(now);
                const currentWeekEnd = getEndOfWeek(now);
                const recordDate = new Date(dateStr);
                recordDate.setHours(0, 0, 0, 0);
                inPeriod = recordDate >= currentWeekStart && recordDate <= currentWeekEnd;
            } else if (filters.week !== 'all') {
                const weekKey = getWeekKey(date);
                inPeriod = weekKey === filters.week;
            } else {
                inPeriod = true;
            }
        } else if (period === 'monthly') {
            const recordYear = date.getFullYear();
            const recordMonth = date.getMonth();

            if (filters.month === 'last') {
                const lastMonthDate = new Date(now);
                lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
                const lastMonthYear = lastMonthDate.getFullYear();
                const lastMonth = lastMonthDate.getMonth();
                inPeriod = recordYear === lastMonthYear && recordMonth === lastMonth;
            } else if (filters.month === 'current') {
                inPeriod = recordYear === currentYear && recordMonth === currentMonth;
            } else if (filters.month !== 'all') {
                const targetMonth = parseInt(filters.month) - 1;
                let targetYear = currentYear;

                if (filters.year !== 'all' && filters.year !== 'current') {
                    targetYear = parseInt(filters.year);
                }

                inPeriod = recordYear === targetYear && recordMonth === targetMonth;
            } else {
                inPeriod = true;
            }

            if (inPeriod && filters.year !== 'all' && filters.year !== 'current') {
                inPeriod = recordYear === parseInt(filters.year);
            }
        } else if (period === '90days') {
            if (filters.dateFrom && filters.dateTo) {
                const fromDate = new Date(filters.dateFrom);
                const toDate = new Date(filters.dateTo);
                toDate.setHours(23, 59, 59, 999);
                inPeriod = date >= fromDate && date <= toDate;
            } else {
                const days90Ago = new Date(now);
                days90Ago.setDate(days90Ago.getDate() - 90);
                inPeriod = date >= days90Ago && date <= now;
            }
        } else {
            inPeriod = true;
        }

        if (!inPeriod) return false;

        if (filters.employee !== 'all' && fields['Employee Name'] !== filters.employee) {
            return false;
        }

        if (filters.team !== 'all' && fields['Workspace Name'] !== filters.team) {
            return false;
        }

        if (period === 'overall') {
            const recordYear = date.getFullYear();
            const recordMonth = date.getMonth() + 1;

            if (filters.year !== 'all' && recordYear !== parseInt(filters.year)) {
                return false;
            }

            if (filters.month !== 'all' && recordMonth !== parseInt(filters.month)) {
                return false;
            }

            if (filters.dateFrom) {
                const fromDate = new Date(filters.dateFrom);
                if (date < fromDate) return false;
            }

            if (filters.dateTo) {
                const toDate = new Date(filters.dateTo);
                toDate.setHours(23, 59, 59, 999);
                if (date > toDate) return false;
            }
        }

        return true;
    });

    return filtered;
}

// Populate filter dropdowns
function populateFilters(records, period) {
    const employees = new Set();
    const teams = new Set();
    const years = new Set();
    const months = new Set();
    const weeks = new Set();

    records.forEach(record => {
        const fields = record.fields;
        if (fields['Employee Name']) employees.add(fields['Employee Name']);
        if (fields['Workspace Name']) teams.add(fields['Workspace Name']);

        const dateStr = fields['Worklog Date'];
        if (dateStr) {
            const date = new Date(dateStr);
            years.add(date.getFullYear());
            months.add(date.getMonth() + 1);
            weeks.add(getWeekKey(date));
        }
    });

    const employeeSelect = document.getElementById(`${period}-employee-filter`);
    if (employeeSelect) {
        employeeSelect.innerHTML = '<option value="all">All Employees</option>';
        Array.from(employees).sort().forEach(emp => {
            employeeSelect.innerHTML += `<option value="${emp}">${emp}</option>`;
        });
    }

    const teamSelect = document.getElementById(`${period}-team-filter`);
    if (teamSelect) {
        teamSelect.innerHTML = '<option value="all">All Teams</option>';
        Array.from(teams).sort().forEach(team => {
            teamSelect.innerHTML += `<option value="${team}">${team}</option>`;
        });
    }

    if (period === 'weekly') {
        const weekSelect = document.getElementById(`${period}-week-filter`);
        if (weekSelect) {
            weekSelect.innerHTML = `
                <option value="last">Last Week</option>
                <option value="current">Current Week</option>
                <option value="all">All Weeks</option>
            `;

            const sortedWeeks = Array.from(weeks).sort().reverse();
            sortedWeeks.forEach(week => {
                const [year, weekNum] = week.split('-W');
                weekSelect.innerHTML += `<option value="${week}">Week ${weekNum}, ${year}</option>`;
            });

            weekSelect.value = 'last';
        }
    }

    if (period === 'monthly') {
        const monthSelect = document.getElementById(`${period}-month-filter`);
        if (monthSelect) {
            monthSelect.innerHTML = `
                <option value="last">Last Month</option>
                <option value="current">Current Month</option>
                <option value="all">All Months</option>
            `;

            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
            Array.from(months).sort((a, b) => a - b).forEach(month => {
                monthSelect.innerHTML += `<option value="${month}">${monthNames[month - 1]}</option>`;
            });

            monthSelect.value = 'last';
        }

        const yearSelect = document.getElementById(`${period}-year-filter`);
        if (yearSelect) {
            yearSelect.innerHTML = `
                <option value="current">Current Year</option>
                <option value="all">All Years</option>
            `;
            Array.from(years).sort((a, b) => b - a).forEach(year => {
                yearSelect.innerHTML += `<option value="${year}">${year}</option>`;
            });

            yearSelect.value = 'current';
        }
    }

    if (period === 'overall') {
        const yearSelect = document.getElementById(`${period}-year-filter`);
        if (yearSelect) {
            yearSelect.innerHTML = '<option value="all">All Years</option>';
            Array.from(years).sort((a, b) => b - a).forEach(year => {
                yearSelect.innerHTML += `<option value="${year}">${year}</option>`;
            });
        }

        const monthSelect = document.getElementById(`${period}-month-filter`);
        if (monthSelect) {
            monthSelect.innerHTML = '<option value="all">All Months</option>';
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
            Array.from(months).sort((a, b) => a - b).forEach(month => {
                monthSelect.innerHTML += `<option value="${month}">${monthNames[month - 1]}</option>`;
            });
        }
    }
}

// Setup filter listeners
function setupFilterListeners(period) {
    const employeeFilter = document.getElementById(`${period}-employee-filter`);
    const teamFilter = document.getElementById(`${period}-team-filter`);
    const resetButton = document.querySelector(`.reset-button[data-period="${period}"]`);

    if (employeeFilter) {
        employeeFilter.addEventListener('change', (e) => {
            currentFilters[period].employee = e.target.value;
            updateDashboard(period);
        });
    }

    if (teamFilter) {
        teamFilter.addEventListener('change', (e) => {
            currentFilters[period].team = e.target.value;
            updateDashboard(period);
        });
    }

    if (period === 'weekly') {
        const weekFilter = document.getElementById(`${period}-week-filter`);
        if (weekFilter) {
            weekFilter.addEventListener('change', (e) => {
                currentFilters[period].week = e.target.value;
                updateDashboard(period);
            });
        }
    }

    if (period === 'monthly') {
        const monthFilter = document.getElementById(`${period}-month-filter`);
        const yearFilter = document.getElementById(`${period}-year-filter`);

        if (monthFilter) {
            monthFilter.addEventListener('change', (e) => {
                currentFilters[period].month = e.target.value;
                updateDashboard(period);
            });
        }

        if (yearFilter) {
            yearFilter.addEventListener('change', (e) => {
                currentFilters[period].year = e.target.value;
                updateDashboard(period);
            });
        }
    }

    if (period === 'overall') {
        const yearFilter = document.getElementById(`${period}-year-filter`);
        const monthFilter = document.getElementById(`${period}-month-filter`);
        const dateFromFilter = document.getElementById(`${period}-date-from`);
        const dateToFilter = document.getElementById(`${period}-date-to`);

        if (yearFilter) {
            yearFilter.addEventListener('change', (e) => {
                currentFilters[period].year = e.target.value;
                updateDashboard(period);
            });
        }

        if (monthFilter) {
            monthFilter.addEventListener('change', (e) => {
                currentFilters[period].month = e.target.value;
                updateDashboard(period);
            });
        }

        if (dateFromFilter) {
            dateFromFilter.addEventListener('change', (e) => {
                currentFilters[period].dateFrom = e.target.value;
                updateDashboard(period);
            });
        }

        if (dateToFilter) {
            dateToFilter.addEventListener('change', (e) => {
                currentFilters[period].dateTo = e.target.value;
                updateDashboard(period);
            });
        }
    }

    if (period === '90days') {
        const dateFromFilter = document.getElementById(`${period}-date-from`);
        const dateToFilter = document.getElementById(`${period}-date-to`);

        if (dateFromFilter) {
            dateFromFilter.addEventListener('change', (e) => {
                currentFilters[period].dateFrom = e.target.value;
                updateDashboard(period);
            });
        }

        if (dateToFilter) {
            dateToFilter.addEventListener('change', (e) => {
                currentFilters[period].dateTo = e.target.value;
                updateDashboard(period);
            });
        }
    }

    if (resetButton) {
        resetButton.addEventListener('click', () => {
            resetFilters(period);
        });
    }
}

// Reset filters
function resetFilters(period) {
    if (period === 'weekly') {
        currentFilters[period] = { employee: 'all', team: 'all', week: 'last' };
        document.getElementById(`${period}-week-filter`).value = 'last';
    } else if (period === 'monthly') {
        currentFilters[period] = { employee: 'all', team: 'all', month: 'last', year: 'current' };
        document.getElementById(`${period}-month-filter`).value = 'last';
        document.getElementById(`${period}-year-filter`).value = 'current';
    } else if (period === 'overall') {
        currentFilters[period] = { employee: 'all', team: 'all', year: 'all', month: 'all', dateFrom: '', dateTo: '' };
        document.getElementById(`${period}-year-filter`).value = 'all';
        document.getElementById(`${period}-month-filter`).value = 'all';
        document.getElementById(`${period}-date-from`).value = '';
        document.getElementById(`${period}-date-to`).value = '';
    } else if (period === '90days') {
        currentFilters[period] = { employee: 'all', team: 'all', dateFrom: '', dateTo: '' };
        const dateFromEl = document.getElementById(`${period}-date-from`);
        const dateToEl = document.getElementById(`${period}-date-to`);
        if (dateFromEl) dateFromEl.value = '';
        if (dateToEl) dateToEl.value = '';
    }

    document.getElementById(`${period}-employee-filter`).value = 'all';
    document.getElementById(`${period}-team-filter`).value = 'all';

    updateDashboard(period);
}

// Calculate metrics
function calculateMetrics(records) {
    const metrics = {
        totalBillable: 0,
        totalNonBillable: 0,
        employeeData: {}
    };

    records.forEach(record => {
        const fields = record.fields;
        const emp = fields['Employee Name'] || 'Unknown';
        const billable = fields['Billable Hours'] || 0;
        const nonBillable = fields['Non-Billable Hours'] || 0;

        metrics.totalBillable += billable;
        metrics.totalNonBillable += nonBillable;

        if (!metrics.employeeData[emp]) {
            metrics.employeeData[emp] = {
                billable: 0,
                nonBillable: 0,
                weeks: new Set()
            };
        }

        metrics.employeeData[emp].billable += billable;
        metrics.employeeData[emp].nonBillable += nonBillable;

        const date = new Date(fields['Worklog Date']);
        const weekKey = `${date.getFullYear()}-W${getWeekNumber(date)}`;
        metrics.employeeData[emp].weeks.add(weekKey);
    });

    Object.keys(metrics.employeeData).forEach(emp => {
        const data = metrics.employeeData[emp];
        const total = data.billable + data.nonBillable;

        data.utilization = total > 0 ? (data.billable / total) : 0;

        const weeks = data.weeks.size || 1;
        const expectedHours = 40 * weeks;
        data.capacity = expectedHours > 0 ? (data.billable / expectedHours) : 0;
    });

    const totalHours = metrics.totalBillable + metrics.totalNonBillable;
    metrics.avgUtilization = totalHours > 0 ? (metrics.totalBillable / totalHours) : 0;

    const allWeeks = new Set();
    Object.values(metrics.employeeData).forEach(d => {
        d.weeks.forEach(w => allWeeks.add(w));
    });
    const totalWeeks = allWeeks.size || 1;
    const employeeCount = Object.keys(metrics.employeeData).length || 1;
    const totalExpectedHours = 40 * totalWeeks * employeeCount;
    metrics.avgCapacity = totalExpectedHours > 0 ? (metrics.totalBillable / totalExpectedHours) : 0;

    return metrics;
}

// Calculate EBR: Revenue ÷ Billable Hours
function calculateEBR(totalRevenue, totalBillableHours) {
    return totalBillableHours > 0 ? (totalRevenue / totalBillableHours) : 0;
}

// Calculate Gross Margin: (Revenue - Direct Costs) / Revenue
function calculateGrossMargin(totalRevenue, directCosts) {
    return totalRevenue > 0 ? ((totalRevenue - directCosts) / totalRevenue) * 100 : 0;
}

// Get direct costs from Job Costing table - EXCLUDE Change Orders
function getDirectCostsForPeriod(startDate, endDate) {
    let totalDirectCosts = 0;

    costingData.forEach(record => {
        const fields = record.fields;
        const dateStr = fields['Date'] || fields['Cost Date'];
        const isChangeOrder = fields['Is Change Order'] || fields['Change Order'] === true;

        if (dateStr) {
            const costDate = new Date(dateStr);
            costDate.setHours(0, 0, 0, 0);

            // Only include base job costs, exclude change orders
            if (!isChangeOrder && costDate >= startDate && costDate <= endDate) {
                const directCost = parseFloat(fields['Direct Cost'] || fields['Labor Cost'] || fields['Cost'] || 0) || 0;
                totalDirectCosts += directCost;
            }
        }
    });

    return totalDirectCosts;
}

// Calculate 90 days metrics with EBR and Gross Margin
function calculate90DaysMetrics(records, revenueRecords) {
    const metrics = calculateMetrics(records);

    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const days90Ago = new Date(now);
    days90Ago.setDate(days90Ago.getDate() - 90);
    days90Ago.setHours(0, 0, 0, 0);

    let totalRevenue = 0;

    revenueRecords.forEach(record => {
        const fields = record.fields;
        const dateStr = fields['Date'] || fields['Invoice Date'] || fields['Created'];

        if (dateStr) {
            const date = new Date(dateStr);
            date.setHours(0, 0, 0, 0);

            if (date >= days90Ago && date <= now) {
                const revenue = parseFloat(fields['Revenue'] || fields['Amount'] || fields['Total'] || 0) || 0;
                totalRevenue += revenue;
            }
        }
    });

    // Get direct costs for 90-day period (excludes change orders)
    const directCosts = getDirectCostsForPeriod(days90Ago, now);

    metrics.totalRevenue = totalRevenue;
    metrics.directCosts = directCosts;
    metrics.ebr = calculateEBR(totalRevenue, metrics.totalBillable);
    metrics.grossMarginPercent = calculateGrossMargin(totalRevenue, directCosts);

    console.log(`💰 90 Days Metrics - Company Level (Rolling):`, {
        totalRevenue: `$${totalRevenue.toFixed(2)}`,
        totalBillableHours: `${metrics.totalBillable.toFixed(2)}h`,
        directCosts: `$${directCosts.toFixed(2)}`,
        ebr: `$${metrics.ebr.toFixed(2)}`,
        grossMarginPercent: `${metrics.grossMarginPercent.toFixed(1)}%`
    });

    return metrics;
}

// Calculate monthly metrics with EBR and Gross Margin
function calculateMonthlyMetrics(records, revenueRecords, monthNum, yearNum) {
    const metrics = calculateMetrics(records);

    const startDate = new Date(yearNum, monthNum - 1, 1);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(yearNum, monthNum, 0);
    endDate.setHours(23, 59, 59, 999);

    let totalRevenue = 0;

    revenueRecords.forEach(record => {
        const fields = record.fields;
        const dateStr = fields['Date'] || fields['Invoice Date'];

        if (dateStr) {
            const date = new Date(dateStr);
            date.setHours(0, 0, 0, 0);

            if (date >= startDate && date <= endDate) {
                const revenue = parseFloat(fields['Revenue'] || fields['Amount'] || 0) || 0;
                totalRevenue += revenue;
            }
        }
    });

    const directCosts = getDirectCostsForPeriod(startDate, endDate);

    metrics.totalRevenue = totalRevenue;
    metrics.directCosts = directCosts;
    metrics.ebr = calculateEBR(totalRevenue, metrics.totalBillable);
    metrics.grossMarginPercent = calculateGrossMargin(totalRevenue, directCosts);

    return metrics;
}

// Render dashboard
function renderDashboard(period, metrics, filteredCount, totalCount) {
    const is90Days = period === '90days';
    const isMonthly = period === 'monthly';

    const filterInfo = document.getElementById(`${period}-filter-info`);
    if (filterInfo) {
        filterInfo.textContent = `Showing ${filteredCount.toLocaleString()} of ${totalCount.toLocaleString()} records`;
    }

    const kpisContainer = document.getElementById(`${period}-kpis`);
    kpisContainer.innerHTML = `
        <div class="kpi-card">
            <p class="kpi-label">Total Billable Hours</p>
            <p class="kpi-value">${metrics.totalBillable.toFixed(2)}</p>
        </div>
        <div class="kpi-card">
            <p class="kpi-label">Non-Billable Hours</p>
            <p class="kpi-value">${metrics.totalNonBillable.toFixed(2)}</p>
        </div>
        <div class="kpi-card">
            <p class="kpi-label">Total Hours</p>
            <p class="kpi-value">${(metrics.totalBillable + metrics.totalNonBillable).toFixed(2)}</p>
        </div>
        <div class="kpi-card">
            <p class="kpi-label">Utilization Rate</p>
            <p class="kpi-value">${(metrics.avgUtilization * 100).toFixed(1)}%</p>
            <p class="kpi-formula">Billable / Total Hours</p>
        </div>
        <div class="kpi-card">
            <p class="kpi-label">Capacity Rate</p>
            <p class="kpi-value">${(metrics.avgCapacity * 100).toFixed(1)}%</p>
            <p class="kpi-formula">Billable / (40hrs/week)</p>
        </div>
        ${(is90Days || isMonthly) ? `
        <div class="kpi-card">
            <p class="kpi-label">Total Revenue</p>
            <p class="kpi-value">$${metrics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
        <div class="kpi-card">
            <p class="kpi-label">Direct Costs</p>
            <p class="kpi-value">$${metrics.directCosts.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            <p class="kpi-formula">Excl. Change Orders</p>
        </div>
        <div class="kpi-card">
            <p class="kpi-label">EBR</p>
            <p class="kpi-value">$${metrics.ebr.toFixed(2)}</p>
            <p class="kpi-formula">Revenue ÷ Bill Hours</p>
        </div>
        <div class="kpi-card">
            <p class="kpi-label">Gross Margin %</p>
            <p class="kpi-value">${metrics.grossMarginPercent.toFixed(1)}%</p>
            <p class="kpi-formula">(Rev - Cost) ÷ Rev</p>
        </div>
        ` : ''}
    `;

    const chartsContainer = document.getElementById(`${period}-charts`);
    chartsContainer.innerHTML = `
        <div class="chart-card">
            <h3>Billable vs Non-Billable Hours</h3>
            <canvas id="${period}-pie-chart"></canvas>
        </div>
        <div class="chart-card">
            <h3>Utilization Rate by Employee</h3>
            <canvas id="${period}-utilization-chart"></canvas>
        </div>
        <div class="chart-card">
            <h3>Capacity Rate by Employee</h3>
            <canvas id="${period}-capacity-chart"></canvas>
        </div>
    `;

    renderPieChart(period, metrics.totalBillable, metrics.totalNonBillable);
    renderUtilizationChart(period, metrics.employeeData);
    renderCapacityChart(period, metrics.employeeData);

    const tableContainer = document.getElementById(`${period}-table`);
    tableContainer.innerHTML = `
        <h3>Utilization & Capacity Summary</h3>
        <table>
            <thead>
                <tr>
                    <th>Employee</th>
                    <th>Billable Hours</th>
                    <th>Non-Billable Hours</th>
                    <th>Total Hours</th>
                    <th>Utilization %</th>
                    <th>Capacity %</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(metrics.employeeData)
            .sort(([, a], [, b]) => b.billable - a.billable)
            .map(([name, data]) => `
                        <tr>
                            <td><strong>${name}</strong></td>
                            <td>${data.billable.toFixed(2)}</td>
                            <td>${data.nonBillable.toFixed(2)}</td>
                            <td>${(data.billable + data.nonBillable).toFixed(2)}</td>
                            <td>${(data.utilization * 100).toFixed(1)}%</td>
                            <td>${(data.capacity * 100).toFixed(1)}%</td>
                        </tr>
                    `).join('')}
            </tbody>
        </table>
    `;
}

// Render pie chart
function renderPieChart(period, billable, nonBillable) {
    const ctx = document.getElementById(`${period}-pie-chart`).getContext('2d');

    if (charts[`${period}-pie`]) {
        charts[`${period}-pie`].destroy();
    }

    charts[`${period}-pie`] = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Billable', 'Non-Billable'],
            datasets: [{
                data: [billable, nonBillable],
                backgroundColor: ['#3b82f6', '#f59e0b']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

// Render utilization chart
function renderUtilizationChart(period, employeeData) {
    const ctx = document.getElementById(`${period}-utilization-chart`).getContext('2d');

    if (charts[`${period}-util`]) {
        charts[`${period}-util`].destroy();
    }

    const sorted = Object.entries(employeeData)
        .sort(([, a], [, b]) => b.utilization - a.utilization)
        .slice(0, 10);

    charts[`${period}-util`] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(([name]) => name),
            datasets: [{
                label: 'Utilization %',
                data: sorted.map(([, data]) => data.utilization * 100),
                backgroundColor: '#10b981'
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: value => value + '%'
                    }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// Render capacity chart
function renderCapacityChart(period, employeeData) {
    const ctx = document.getElementById(`${period}-capacity-chart`).getContext('2d');

    if (charts[`${period}-cap`]) {
        charts[`${period}-cap`].destroy();
    }

    const sorted = Object.entries(employeeData)
        .sort(([, a], [, b]) => b.capacity - a.capacity)
        .slice(0, 10);

    charts[`${period}-cap`] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(([name]) => name),
            datasets: [{
                label: 'Capacity %',
                data: sorted.map(([, data]) => data.capacity * 100),
                backgroundColor: '#8b5cf6'
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: value => value + '%'
                    }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// Update dashboard with current filters
function updateDashboard(period) {
    let defaultFilters;
    if (period === 'weekly') {
        defaultFilters = { employee: 'all', team: 'all', week: 'last' };
    } else if (period === 'monthly') {
        defaultFilters = { employee: 'all', team: 'all', month: 'last', year: 'current' };
    } else if (period === '90days') {
        defaultFilters = { employee: 'all', team: 'all', dateFrom: '', dateTo: '' };
    } else {
        defaultFilters = { employee: 'all', team: 'all', year: 'all', month: 'all', dateFrom: '', dateTo: '' };
    }

    const baseRecords = filterRecordsByPeriod(allRecords, period, defaultFilters);
    const filteredRecords = filterRecordsByPeriod(allRecords, period, currentFilters[period]);

    let metrics;
    if (period === '90days') {
        metrics = calculate90DaysMetrics(filteredRecords, revenueData);
    } else if (period === 'monthly') {
        const monthNum = parseInt(currentFilters[period].month) || new Date().getMonth() + 1;
        const yearNum = parseInt(currentFilters[period].year) || new Date().getFullYear();
        metrics = calculateMonthlyMetrics(filteredRecords, revenueData, monthNum, yearNum);
    } else {
        metrics = calculateMetrics(filteredRecords);
    }

    renderDashboard(period, metrics, filteredRecords.length, baseRecords.length);
}

// Initialize dashboard
async function init() {
    try {
        document.getElementById('loading').style.display = 'block';

        // Fetch all data tables
        [allRecords, revenueData, projectsData, costingData] = await Promise.all([
            fetchAllRecords(CONFIG.TABLE_NAME),
            fetchAllRecords(CONFIG.REVENUE_TABLE_NAME),
            fetchAllRecords(CONFIG.PROJECTS_TABLE_NAME).catch(() => []),
            fetchAllRecords(CONFIG.COSTING_TABLE_NAME).catch(() => [])
        ]);

        console.log(`✅ Loaded ${allRecords.length} time tracking records`);
        console.log(`✅ Loaded ${revenueData.length} revenue records`);
        console.log(`✅ Loaded ${projectsData.length} project records`);
        console.log(`✅ Loaded ${costingData.length} job costing records`);

        // Setup each dashboard
        const periods = ['weekly', 'monthly', 'overall', '90days'];
        periods.forEach(period => {
            populateFilters(allRecords, period);
            setupFilterListeners(period);
            updateDashboard(period);
        });

        // Setup tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                const period = button.dataset.period;

                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                button.classList.add('active');

                document.querySelectorAll('.dashboard-container').forEach(d => d.classList.remove('active'));
                document.getElementById(`${period}-dashboard`).classList.add('active');
            });
        });

        document.getElementById('loading').style.display = 'none';

    } catch (error) {
        console.error('Error:', error);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').innerHTML = `
            <div class="error">
                <strong>Error:</strong> ${error.message}
            </div>
        `;
        document.getElementById('error').style.display = 'block';
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);