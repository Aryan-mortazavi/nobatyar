/* پنل مدیریت - tiny progressive enhancements (no framework) */

// 1) Destructive forms must be confirmed first
document.addEventListener("submit", function (event) {
  var form = event.target;
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
    event.preventDefault();
  }
});

// 2) Settings page: collect every input into the JSON payload of the form
var settingsForm = document.getElementById("settings-form");
if (settingsForm) {
  settingsForm.addEventListener("submit", function () {
    var payload = {};
    settingsForm.querySelectorAll("[data-setting]").forEach(function (input) {
      payload[input.getAttribute("data-setting")] = input.value;
    });
    settingsForm.querySelector("[name='values']").value = JSON.stringify(payload);
  });
}

// 3) Show the current Jalali date in the header (optional nicety)
var jalaliBox = document.getElementById("jalali-today");
if (jalaliBox && jalaliBox.dataset.value) {
  jalaliBox.textContent = "امروز: " + jalaliBox.dataset.value;
}
