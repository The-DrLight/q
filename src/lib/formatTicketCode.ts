export function formatTicketCode(ticketNumber: number | null | undefined): string {
  if (!ticketNumber || ticketNumber <= 0) return "---";

  const zeroIndexed = ticketNumber - 1;
  const cycle = Math.floor(zeroIndexed / 99) % 26;
  const letter = String.fromCharCode(65 + cycle); // A = 65, B = 66, ...
  const num = (zeroIndexed % 99) + 1;

  return `${letter}${num.toString().padStart(2, "0")}`;
}
