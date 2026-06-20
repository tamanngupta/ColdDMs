console.log('sidepanel.js loaded');

function render(logs) {
  const container = document.getElementById('logs');
  if (!logs || !logs.length) {
    container.innerHTML = '<div class="empty">No DMs logged yet.<br>Open a LinkedIn conversation to start tracking.</div>';
    return;
  }

  const unique = [...logs].reverse();

  container.innerHTML = unique.map(l => `
    <div class="entry">
      <div class="name">${l.name}</div>
      
      <div class="label">hook</div>
      <div class="value">${(l.hook || '').slice(0, 150)}</div>
      
      <div class="label">summary</div>
      <div class="value">${l.detailedSummary || 'summarizing...'}</div>

      ${l.building ? `
        <div class="label">building</div>
        <div class="value">${l.building}</div>
      ` : ''}

      ${l.painPoint ? `
        <div class="label">pain point</div>
        <div class="value">${l.painPoint}</div>
      ` : ''}

      ${l.nextStep ? `
        <div class="label">next step</div>
        <div class="value">${l.nextStep}</div>
      ` : ''}

      <div style="margin-top: 8px;">
        ${l.replyReceived ? '<span class="badge replied">replied</span>' : '<span class="badge pending">no reply</span>'}
        ${l.sentiment ? `<span class="badge sentiment-${l.sentiment}">${l.sentiment}</span>` : ''}
        ${l.meetFlagged ? '<span class="badge meet">meet flagged 📅</span>' : ''}
        ${l.actionPending ? '<span class="badge action">action pending</span>' : ''}
      </div>

      <div class="timestamp">${new Date(l.timestamp).toLocaleString('en-IN')}</div>
    </div>
  `).join('');
}

function load() {
  chrome.storage.local.get('dmLogs', function(result) {
    render(result.dmLogs || []);
  });
}

document.getElementById('clearBtn').addEventListener('click', function() {
  chrome.storage.local.set({ dmLogs: [] }, load);
});

load();
setInterval(load, 2000);