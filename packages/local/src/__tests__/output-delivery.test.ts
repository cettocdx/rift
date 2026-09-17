import { OutputDelivery } from '../output-delivery';

describe('ordered relay output delivery', () => {
  it('retains output through failures and sends exit last', async () => {
    let failures = 4;
    const received: object[] = [];
    const delivery = new OutputDelivery(async data => {
      if (failures-- > 0) throw new Error('offline');
      received.push(data);
    }, 1);
    await Promise.all([
      delivery.send({ type: 'stdout', data: 'first' }),
      delivery.send({ type: 'stdout', data: 'second' }),
      delivery.send({ type: 'exit', exitCode: 0 }),
    ]);
    expect(received).toMatchObject([{data:'first'},{data:'second'},{type:'exit'}]);
  });
  it('reuses delivery identity when acknowledgement is lost', async () => {
    const ids: string[] = [];
    const delivery = new OutputDelivery(async data => {
      ids.push((data as {deliveryId:string}).deliveryId);
      if (ids.length === 1) throw new Error('ack lost');
    }, 1);
    await delivery.send({type:'stdout',data:'one'});
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });
  it('rejects after shutdown', async () => {
    const delivery = new OutputDelivery(async () => {});
    delivery.stop();
    await expect(delivery.send({type:'exit'})).rejects.toThrow('stopped');
  });
  it('never reports successful completion after buffer overflow', async () => {
    const delivery = new OutputDelivery(async () => {}, 1, 100, 120);
    await expect(delivery.send({data:'x'.repeat(200)})).rejects.toThrow('buffer');
    await expect(delivery.send({type:'exit'})).rejects.toThrow('buffer');
  });
});
