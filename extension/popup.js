const fields = ['apiKey', 'provider', 'awsKeyId', 'awsSecret', 'awsRegion', 'glueDatabase', 'athenaOutput'];

chrome.storage.sync.get(fields, (data) => {
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el && data[f]) el.value = data[f];
  });
});

document.getElementById('save').addEventListener('click', () => {
  const values = {};
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el) values[f] = el.value.trim();
  });

  chrome.storage.sync.set(values, () => {
    const saved = document.getElementById('saved');
    saved.textContent = 'Saved ✓';
    setTimeout(() => saved.textContent = '', 2000);
  });
});
