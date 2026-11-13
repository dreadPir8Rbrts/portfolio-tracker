import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dealSchema,eventSchema} from '../lib/model';
import {salePerformance} from '../lib/sales';
import {balances} from '../lib/ledger';

test('equal per-card expenses conserve costs across unequal basis and partial quantities',()=>{
 const a=crypto.randomUUID(),b=crypto.randomUUID();
 const deal=dealSchema.parse({id:crypto.randomUUID(),name:'Synthetic bundle',source:'Test',variant:'',grade:'',acquired:'2026-01-01',cost:90000,notes:'',items:'Three cards',expenseAllocation:'equal_per_card',members:[{person:'dread',weight:1,funded:90000},{person:'1of1',weight:1,funded:0}],inventory:[{id:a,kind:'card',name:'Two cards',quantity:2,cost:80000},{id:b,kind:'card',name:'One card',quantity:1,cost:10000}]});
 const make=(p:Record<string,unknown>)=>eventSchema.parse({id:crypto.randomUUID(),dealId:deal.id,date:'2026-01-02',from:'dread',to:null,notes:'Synthetic test',...p});
 const expense=make({kind:'expense',amount:1001});
 const sales=[a,a,b].map((itemId,i)=>make({kind:'sale',date:`2026-01-0${i+3}`,amount:50000,saleTerms:{total:50000,fees:0},soldItems:[{itemId,quantity:1}]}));
 const result=salePerformance(deal,[expense,...sales]);
 assert.deepEqual(result.rows.map(r=>r.expenseCost),[333,334,334]);
 assert.equal(result.rows.reduce((n,r)=>n+r.expenseCost!,0),1001);
 assert.equal(result.profit,58999);
 const proportional={...deal,expenseAllocation:undefined};
 assert.notDeepEqual(salePerformance(proportional,[expense,...sales]).rows.map(r=>r.expenseCost),result.rows.map(r=>r.expenseCost));
 assert.deepEqual(balances([deal],[expense,...sales]),balances([proportional],[expense,...sales]));
 assert.deepEqual(salePerformance({...deal,expenseAllocation:'purchase_cost'},[expense,...sales]),salePerformance(proportional,[expense,...sales]));
});
