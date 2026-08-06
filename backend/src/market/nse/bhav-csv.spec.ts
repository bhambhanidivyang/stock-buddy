import { parseBhavCsv } from './bhav-csv';

const UCC_HEADER =
  'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4';

describe('parseBhavCsv', () => {
  it('parses UCC EQ rows and skips GB', () => {
    const gb =
      '2026-08-04,2026-08-04,CM,NSE,STK,19078,IN0020200104,SGBJUN28,GB,,,,,2.5%GOLDBONDS2028SR-III,14150.00,14150.00,14150.00,14150.00,14150.00,14159.91,,14150.00,,,1,14150.00,1,F1,1,,,,,';
    const eq =
      '2026-08-04,2026-08-04,CM,NSE,STK,2885,INE002A01018,RELIANCE,EQ,,,,,Reliance Industries Limited,1400.00,1410.00,1390.00,1405.50,1405.00,1400.00,,1405.50,,,1000000,1405500000.00,5000,F1,1,,,,,';
    const rows = parseBhavCsv([UCC_HEADER, gb, eq].join('\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('RELIANCE');
    expect(rows[0].close).toBe(1405.5);
    expect(rows[0].volume).toBe(1000000);
    expect(rows[0].tradedValue).toBe(1405500000);
  });
});
