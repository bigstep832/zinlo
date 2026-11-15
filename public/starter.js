const form = document.querySelector('#task-form');
const input = document.querySelector('#task-name');
const list = document.querySelector('#task-list');
// Replace this starter handler with your implementation.
form.addEventListener('submit', event => {
  event.preventDefault();
  document.querySelector('#status').textContent = 'Now implement adding "' + input.value.trim() + '" in your saved starter.js file.';
});
