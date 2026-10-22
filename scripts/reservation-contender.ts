import { openDatabase } from '../src/persistence/database.js';
import { reserve, type ReserveRequest } from '../src/application/reserve.js';

const db = openDatabase(process.env.CREDIT_TEST_PATH!);
const request = JSON.parse(process.env.CREDIT_TEST_REQUEST!) as ReserveRequest;
process.once('message', () => {
  let outcome = 'OK';
  try { reserve(db, request); } catch (error) { outcome = (error as Error).message; }
  db.close();
  process.send!(outcome, () => process.disconnect());
});
process.send!('ready');
