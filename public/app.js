const $ = (id) => document.getElementById(id);
const charts = {};

const chartDefaults = {
  color: "#8b94a5",
  borderColor: "#2a3140",
};
Chart.defaults.color = chartDefaults.color;
Chart.defaults.borderColor = chartDefaults.borderColor;

function scoreColor(score) {
  if (score >= 67) return "green";
  if (score >= 34) return "yellow";
  return "red";
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDuration(ms) {
  const mins = Math.round(ms / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${url} failed (${res.status})`);
  return data;
}

function renderChart(canvasId, config) {
  charts[canvasId]?.destroy();
  charts[canvasId] = new Chart($(canvasId), {
    ...config,
    options: {
      responsive: true,
      plugins: { legend: { display: (config.data.datasets.length > 1) } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: false } },
      ...config.options,
    },
  });
}

function renderRecovery(records) {
  // Records arrive newest-first; charts read left-to-right oldest-first.
  const scored = records.filter((r) => r.score?.recovery_score != null).reverse();
  const latest = scored[scored.length - 1];

  if (latest) {
    const score = Math.round(latest.score.recovery_score);
    $("recovery-score").textContent = `${score}%`;
    $("recovery-score").className = `big-number ${scoreColor(score)}`;
    $("recovery-sub").textContent = fmtDate(latest.created_at);
    $("hrv-value").textContent = Math.round(latest.score.hrv_rmssd_milli);
    $("rhr-value").textContent = Math.round(latest.score.resting_heart_rate);
  }

  const labels = scored.map((r) => fmtDate(r.created_at));
  renderChart("chart-recovery", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Recovery %",
        data: scored.map((r) => Math.round(r.score.recovery_score)),
        backgroundColor: scored.map((r) => {
          const c = scoreColor(r.score.recovery_score);
          return c === "green" ? "#4ade80" : c === "yellow" ? "#facc15" : "#f87171";
        }),
      }],
    },
    options: { scales: { y: { min: 0, max: 100 } } },
  });

  renderChart("chart-hrv", {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "HRV (ms)",
          data: scored.map((r) => Math.round(r.score.hrv_rmssd_milli)),
          borderColor: "#60a5fa",
          tension: 0.3,
        },
        {
          label: "Resting HR (bpm)",
          data: scored.map((r) => Math.round(r.score.resting_heart_rate)),
          borderColor: "#f87171",
          tension: 0.3,
        },
      ],
    },
  });
}

function renderSleep(records) {
  const scored = records
    .filter((s) => s.score && !s.nap)
    .reverse();
  const latest = scored[scored.length - 1];

  if (latest) {
    const perf = latest.score.sleep_performance_percentage;
    $("sleep-score").textContent = perf != null ? `${Math.round(perf)}%` : "–";
    if (perf != null) $("sleep-score").className = `big-number ${scoreColor(perf)}`;
    const asleep = latest.score.stage_summary?.total_in_bed_time_milli;
    $("sleep-sub").textContent = asleep ? `${fmtDuration(asleep)} in bed, ${fmtDate(latest.end)}` : fmtDate(latest.end);
  }

  const labels = scored.map((s) => fmtDate(s.end));
  // The cloud API provides per-stage breakdowns; openwhoop local mode only
  // has total time in bed, so fall back to a single-series chart.
  const hasStages = scored.some(
    (s) => s.score.stage_summary?.total_slow_wave_sleep_time_milli != null
  );
  const datasets = hasStages
    ? [
        {
          label: "Deep (SWS)",
          data: scored.map((s) => (s.score.stage_summary?.total_slow_wave_sleep_time_milli ?? 0) / 3600000),
          backgroundColor: "#3b82f6",
        },
        {
          label: "REM",
          data: scored.map((s) => (s.score.stage_summary?.total_rem_sleep_time_milli ?? 0) / 3600000),
          backgroundColor: "#8b5cf6",
        },
        {
          label: "Light",
          data: scored.map((s) => (s.score.stage_summary?.total_light_sleep_time_milli ?? 0) / 3600000),
          backgroundColor: "#60a5fa",
        },
      ]
    : [
        {
          label: "Time in bed",
          data: scored.map((s) => (s.score.stage_summary?.total_in_bed_time_milli ?? 0) / 3600000),
          backgroundColor: "#60a5fa",
        },
      ];

  renderChart("chart-sleep", {
    type: "bar",
    data: { labels, datasets },
    options: {
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } },
    },
  });
}

function renderCycles(records) {
  const scored = records.filter((c) => c.score?.strain != null).reverse();
  const latest = scored[scored.length - 1];

  if (latest) {
    $("strain-value").textContent = latest.score.strain.toFixed(1);
    $("strain-sub").textContent = latest.score.kilojoule
      ? `${Math.round(latest.score.kilojoule / 4.184)} kcal, ${fmtDate(latest.start)}`
      : fmtDate(latest.start);
  }

  renderChart("chart-strain", {
    type: "line",
    data: {
      labels: scored.map((c) => fmtDate(c.start)),
      datasets: [{
        label: "Strain",
        data: scored.map((c) => c.score.strain),
        borderColor: "#facc15",
        backgroundColor: "rgba(250, 204, 21, 0.15)",
        fill: true,
        tension: 0.3,
      }],
    },
    options: { scales: { y: { min: 0, max: 21 } } },
  });
}

function renderVitals(records) {
  const box = $("vitals-box");
  if (!records.length || !records.some((v) => v.stress ?? v.spo2 ?? v.skin_temp)) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  const series = [
    { key: "stress", label: "Stress", color: "#f87171" },
    { key: "spo2", label: "SpO2 (%)", color: "#60a5fa" },
    { key: "skin_temp", label: "Skin temp (°C)", color: "#facc15" },
  ].filter((s) => records.some((v) => v[s.key] != null));
  renderChart("chart-vitals", {
    type: "line",
    data: {
      labels: records.map((v) => fmtDate(v.day)),
      datasets: series.map((s) => ({
        label: s.label,
        data: records.map((v) => v[s.key]),
        borderColor: s.color,
        tension: 0.3,
        spanGaps: true,
      })),
    },
  });
}

function renderWorkouts(records) {
  const tbody = $("workouts-table").querySelector("tbody");
  tbody.innerHTML = "";
  for (const w of records.slice(0, 15)) {
    const row = tbody.insertRow();
    const cells = [
      fmtDate(w.start),
      w.sport_name ?? "Workout",
      fmtDuration(new Date(w.end) - new Date(w.start)),
      w.score?.strain?.toFixed(1) ?? "–",
      w.score?.average_heart_rate ?? "–",
      w.score?.max_heart_rate ?? "–",
      w.score?.kilojoule ? Math.round(w.score.kilojoule / 4.184) : "–",
    ];
    for (const value of cells) row.insertCell().textContent = value;
  }
}

async function loadDashboard() {
  const days = $("range-select").value;
  $("error-banner").classList.add("hidden");
  try {
    const [profile, recovery, sleep, cycles, workouts, vitals] = await Promise.all([
      fetchJSON("/api/profile"),
      fetchJSON(`/api/recovery?days=${days}`),
      fetchJSON(`/api/sleep?days=${days}`),
      fetchJSON(`/api/cycles?days=${days}`),
      fetchJSON(`/api/workouts?days=${days}`),
      fetchJSON(`/api/vitals?days=${days}`),
    ]);
    $("user-name").textContent = `${profile.profile.first_name} ${profile.profile.last_name}`;
    renderRecovery(recovery);
    renderSleep(sleep);
    renderCycles(cycles);
    renderWorkouts(workouts);
    renderVitals(vitals);
  } catch (err) {
    $("error-banner").textContent = err.message;
    $("error-banner").classList.remove("hidden");
  }
}

async function init() {
  const status = await fetchJSON("/api/status");
  const button = $("auth-button");

  if (status.source === "openwhoop") {
    button.classList.add("hidden");
    if (!status.authenticated) {
      $("error-banner").textContent =
        `openwhoop database not found at ${status.dbPath}. ` +
        "Run `openwhoop download-history` then `openwhoop detect-events` and refresh.";
      $("error-banner").classList.remove("hidden");
      return;
    }
    $("dashboard").classList.remove("hidden");
    $("range-select").onchange = loadDashboard;
    await loadDashboard();
    return;
  }

  if (!status.configured) {
    $("setup-notice").classList.remove("hidden");
    button.disabled = true;
    return;
  }

  if (!status.authenticated) {
    $("login-notice").classList.remove("hidden");
    button.onclick = () => (window.location.href = "/auth/login");
    return;
  }

  button.textContent = "Disconnect";
  button.onclick = async () => {
    await fetch("/auth/logout", { method: "POST" });
    window.location.reload();
  };
  $("dashboard").classList.remove("hidden");
  $("range-select").onchange = loadDashboard;
  await loadDashboard();
}

init();
