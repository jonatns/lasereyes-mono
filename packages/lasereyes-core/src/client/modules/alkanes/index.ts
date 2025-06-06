import type { Account } from '@oyl/sdk/lib/account'
import type { LaserEyesClient } from '../../index'
import { getBitcoinNetwork } from '../../../lib/helpers'
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371'
import { createSendPsbt } from './utils'
import { SandshrewDataSource } from '../../..'
import { AlkaneToken } from './types'

export default class AlkanesModule {
  constructor(private readonly client: LaserEyesClient) {}

  async send(id: string, amount: number, toAddress: string) {
    const { connected, address, publicKey } = this.client.$store.get()
    if (!connected) {
      throw new Error('Client is not connected')
    }

    const alkaneId = {
      block: id.split(':')[0],
      tx: id.split(':')[1],
    }
    if (!alkaneId) {
      throw new Error('Alkane not found')
    }

    const network = this.client.$network.get()
    const bitcoinNetwork = getBitcoinNetwork(network)
    const account: Account = {
      network: bitcoinNetwork,
      spendStrategy: {
        utxoSortGreatestToLeast: true,
        changeAddress: 'taproot',
        addressOrder: ['taproot', 'nestedSegwit', 'legacy', 'nativeSegwit'],
      },
      taproot: {
        address: address,
        pubkey: publicKey,
        pubKeyXOnly: toXOnly(Buffer.from(publicKey, 'hex')).toString(),
        hdPath: `m/84'/1'/0'/0/0`,
      },
      nestedSegwit: {
        address: address,
        pubkey: publicKey,
        hdPath: `m/84'/1'/0'/0/0`,
      },
      legacy: {
        address: address,
        pubkey: publicKey,
        hdPath: `m/49'/1'/0'/0/0`,
      },
      nativeSegwit: {
        address: address,
        pubkey: publicKey,
        hdPath: `m/84'/1'/0'/0/0`,
      },
    }
    const { fastFee } = await this.client.dataSourceManager.getRecommendedFees()
    const utxos = await this.client.dataSourceManager.getAddressUtxos(address)
    const { psbt } = await createSendPsbt({
      gatheredUtxos: {
        utxos: utxos.map((utxo) => ({
          txId: utxo.txid,
          outputIndex: utxo.vout,
          satoshis: utxo.value,
          scriptPk: utxo.scriptPk,
          address,
          inscriptions: [],
          confirmations: Number(utxo.status.confirmed),
        })),
        totalAmount: utxos.reduce((acc, utxo) => acc + utxo.value, 0),
      },
      account,
      alkaneId,
      client: this.client,
      toAddress,
      amount,
      feeRate: fastFee,
    })

    const response = await this.client.signPsbt({
      tx: psbt,
      broadcast: true,
      finalize: true,
    })
    if (!response) {
      throw new Error('Failed to sign transaction')
    }
    if (response.txId) {
      return response.txId
    }
    const txId = await this.client.pushPsbt(
      response.signedPsbtHex ?? response.signedPsbtBase64!
    )
    if (txId) {
      return txId
    }
    throw new Error('Failed to broadcast transaction')
  }

  async getAlkanes({
    limit = 10,
    offset,
  }: {
    limit: number
    offset?: number
  }): Promise<AlkaneToken[]> {
    const sandshrewDs = this.client.dataSourceManager.getSource(
      'sandshrew'
    ) as SandshrewDataSource
    return (
      await sandshrewDs.alkanesRpc.getAlkanes({
        limit,
        offset: offset,
      })
    ).flatMap((alkane) => ({
      ...alkane,
    }))
  }
}
