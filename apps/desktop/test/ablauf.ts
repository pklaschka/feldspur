/**
 * Gliedert einen Oberflächentest in kleine Abläufe mit Namen, damit er sich liest wie das Handbuch:
 *
 *   const id = await ablauf("Einen Einsatz anlegen", async () => { … return id; });
 *
 * Druckt den Namen beim Start und setzt ihn vor die Meldung, wenn der Ablauf scheitert; verschachtelte Abläufe
 * erscheinen als „Außen › Innen“. Der Rückgabewert reicht Werte an die folgenden Abläufe weiter.
 */
const names: string[] = [];
const named = new WeakSet<Error>();

export async function ablauf<T>(name: string, run: () => Promise<T>): Promise<T> {
  names.push(name);
  console.log(`${"  ".repeat(names.length - 1)}— ${name}`);
  try {
    return await run();
  } catch (e) {
    if (e instanceof Error && !named.has(e)) {
      e.message = `${names.join(" › ")}: ${e.message}`;
      named.add(e);
    }
    throw e;
  } finally {
    names.pop();
  }
}
