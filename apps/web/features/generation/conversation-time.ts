export function formatConversationTime(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay =
    sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();

  if (sameDay) return time;
  const monthAndDay = `${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
  return sameYear ? `${monthAndDay} ${time}` : `${date.getFullYear()}-${monthAndDay} ${time}`;
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}
