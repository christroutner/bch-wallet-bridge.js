import IWallet from "./IWallet"
import ChangeType from "../web3bch-providers/entities/ChangeType"
import Utxo from "../web3bch-providers/entities/Utxo"
import Network from "./entities/Network"
import Destination from "./entities/Destination"
import Output from "../web3bch-providers/entities/Output"
import Providers from "../web3bch/Providers"
import IWalletProvider from "../web3bch-providers/IWalletProvider"
import IllegalArgumentException from "./entities/IllegalArgumentException"
import ProviderException from "./entities/ProviderException"
import INetworkProvider from "../web3bch-providers/INetworkProvider"
import ProviderType from "./entities/ProviderType"
import { findNetwork } from "./networks"
import { isCashAddress, isP2SHAddress, toCashAddress, toLegacyAddress } from "bchaddrjs"
import * as bitcoincashjs from "bitcoincashjs"

export default class Wallet implements IWallet {
  private defaultDAppId?: string

  constructor(readonly providers: Providers) {}

  public getAddress(
    changeType: ChangeType,
    index?: number,
    dAppId?: string
  ): Promise<string> {
    return this.getAddresses(changeType, index, 1, dAppId)
      .then((addresses) => {
        const address = addresses[0]
        if (typeof address !== "string") {
          throw new ProviderException("The return value is invalid.")
        }
        return address
      })
      .catch((e) => { throw new ProviderException(e) })
  }

  public getAddressIndex(
    changeType: ChangeType,
    dAppId?: string
  ): Promise<number> {
    const walletProvider = this.checkWalletProvider()
    return walletProvider.getAddressIndex(changeType, dAppId || this.defaultDAppId)
      .then((index) => {
        if (!Number.isInteger(index) || index < 0 || index > 2147483647) {
          throw new ProviderException("The return value is invalid.")
        }
        return index
      })
      .catch((e) => { throw new ProviderException(e) })
  }

  public getAddresses(
    changeType: ChangeType,
    startIndex?: number,
    size?: number,
    dAppId?: string
  ): Promise<string[]> {
    if (startIndex) {
      if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > 2147483647) {
        throw new IllegalArgumentException("startIndex is an invalid value.")
      }
    }
    if (size !== undefined) {
      if (!Number.isInteger(size) || size < 1) {
        throw new IllegalArgumentException("size is an invalid value")
      }
    }
    if (startIndex && size) {
      if (startIndex + size > 2147483647) {
        throw new IllegalArgumentException("the max index must be <= 2147483647")
      }
    }
    const walletProvider = this.checkWalletProvider()
    return walletProvider.getAddresses(changeType, size || 1, startIndex, dAppId || this.defaultDAppId)
      .then((addresses) => {
        if (!(addresses instanceof Array) || addresses.length === 0 || typeof addresses[0] !== "string") {
          throw new ProviderException("The return value is invalid.")
        }
        return addresses
      })
      .catch((e) => { throw new ProviderException(e) })
  }

  public async getRedeemScript(
    p2shAddress: string,
    dAppId?: string
  ): Promise<string | undefined> {
    if (!this.isP2SHCashAddress(p2shAddress)) {
      throw new IllegalArgumentException("The address is not P2SH Address or Cash Address.")
    }
    const redeemScripts = await this.getRedeemScripts(dAppId)
    return redeemScripts.find((script) => this.toAddressFromScript(script) === p2shAddress)
  }

  public async getRedeemScripts(
    dAppId?: string
  ): Promise<string[]> {
    const walletProvider = this.checkWalletProvider()
    const redeemScripts = await walletProvider.getRedeemScripts(dAppId || this.defaultDAppId)
      .catch((e) => { throw new ProviderException(e) })
    if (!Array.isArray(redeemScripts) || (redeemScripts.length > 0 && typeof redeemScripts[0] !== "string")) {
      throw new ProviderException("The WalletProvider provides invalid type.")
    }
    return redeemScripts
  }

  public async addRedeemScript(
    redeemScript: string,
    dAppId: string
  ): Promise<void> {
    if (redeemScript.length < 1) {
      throw new IllegalArgumentException("The redeemScript cannot be empty.")
    }

    const walletProvider = this.checkWalletProvider()
    const result = await walletProvider.addRedeemScript(redeemScript, dAppId || this.defaultDAppId)
      .catch((e) => { throw new ProviderException(e) })

    if (typeof result !== "undefined") {
      throw new ProviderException("The provider returns illegal value.")
    }
  }

  public async getUtxos(
    dAppId?: string
  ): Promise<Utxo[]> {
    const walletProvider = this.checkWalletProvider()
    const utxos: Utxo[] = []
    if (dAppId) {
      const unspendableUtxos = await walletProvider.getUnspendableUtxos(dAppId)
        .catch((e) => {
          throw new ProviderException(e)
        })
      const spendableUtxos = await walletProvider.getSpendableUtxos(dAppId)
        .catch((e) => {
          throw new ProviderException(e)
        })
      if (!Array.isArray(unspendableUtxos) || !Array.isArray(spendableUtxos)) {
        throw new ProviderException("The provider returns illegal value.")
      }
      if ((unspendableUtxos.length !== 0 && !(unspendableUtxos[0] instanceof Utxo)) ||
        (spendableUtxos.length !== 0 && !(spendableUtxos[0] instanceof Utxo))) {
        throw new ProviderException("The provider returns illegal value.")
      }
      utxos.push(...unspendableUtxos)
      utxos.push(...spendableUtxos)
    } else {
      const spendableUtxos = await walletProvider.getSpendableUtxos()
        .catch((e) => {
          throw new ProviderException(e)
        })
      if (!Array.isArray(spendableUtxos)) {
        throw new ProviderException("The provider returns illegal value.")
      }
      if (spendableUtxos.length !== 0 && !(spendableUtxos[0] instanceof Utxo)) {
        throw new ProviderException("The provider returns illegal value.")
      }
      utxos.push(...spendableUtxos)
    }
    return utxos
  }

  public async getBalance(
    dAppId?: string
  ): Promise<number> {
    const utxos = await this.getUtxos(dAppId)
    return utxos.reduce((balance, utxo) => balance + utxo.satoshis, 0)
  }

  public sign(
    address: string,
    dataToSign: string
  ): Promise<string> {
    throw new Error("Method not implemented.")
  }

  public async send(
    destination: Destination | Destination[],
    data?: string | string[]
  ): Promise<string> {
    // convert to array
    const destinations = [destination].flatMap((it) => it)
    if (destinations.length === 0) {
      throw new IllegalArgumentException("The destinations cannot be empty.")
    }

    const outputs = destinations.map((dest) => {
      const legacy = toLegacyAddress(dest.address)
      const script = bitcoincashjs.Script.fromAddress(legacy).toBuffer().toString("hex")
      return new Output(script, dest.amount)
    })

    // convert to array
    const dataArr = data ? [data].flatMap((it) => it) : []
    if (dataArr.length !== 0) {
      const opReturnData = Buffer.concat(dataArr.map((it) => Buffer.from(it)))
      const opReturnScript = bitcoincashjs.Script.buildDataOut(opReturnData).toBuffer().toString("hex")
      // append data
      outputs.push(new Output(opReturnScript, 0))
    }

    return this.sendToOutputs(outputs)
  }

  public async advancedSend(
    outputs: Output[],
    dAppId?: string
  ): Promise<string> {
    return this.sendToOutputs(outputs, dAppId || this.defaultDAppId)
  }

  public async getProtocolVersion(providerType: ProviderType): Promise<number> {
    const version = await (() => {
      switch (providerType) {
        case ProviderType.NETWORK:
          const networkProvider = this.checkNetworkProvider()
          return networkProvider.getProtocolVersion()
        case ProviderType.WALLET:
          const walletProvider = this.checkWalletProvider()
          return walletProvider.getProtocolVersion()
      }
    })().catch((e) => { throw new ProviderException(e) })

    if (typeof version !== "number") {
      throw new ProviderException(`${providerType} provides invalid type.`)
    }
    return version
  }

  public async getNetwork(providerType: ProviderType): Promise<Network> {
    const networkProvider = this.checkNetworkProvider()
    const walletProvider = this.checkWalletProvider()

    const magic = await (() => {
      switch (providerType) {
        case ProviderType.NETWORK:
          return networkProvider.getNetworkMagic()
        case ProviderType.WALLET:
          return walletProvider.getNetworkMagic()
      }
    })()

    return findNetwork(magic)
  }

  public broadcastRawTx(
    rawTx: string
  ): Promise<string> {
    return new Promise((resolve) => {
      const networkProvider = this.checkNetworkProvider()
      if (!this.isHex(rawTx)) {
        throw new IllegalArgumentException("The rawTx is not hex.")
      }
      resolve(networkProvider.broadcastRawTx(rawTx))
    })
  }

  public getFeePerByte(): Promise<number> {
    const walletProvider = this.checkWalletProvider()
    return walletProvider.getFeePerByte()
      .then((fee) => {
        if (!Number.isInteger(fee) || fee < 1) {
          throw new ProviderException("The return value is invalid.")
        }
        return fee
      })
      .catch((e) => { throw new ProviderException(e) })
  }

  public getDefaultDAppId(): Promise<string | undefined> {
    return Promise.resolve(this.defaultDAppId)
  }

  public setDefaultDAppId(
    dAppId?: string
  ): Promise<void> {
    return new Promise((resolve) => {
      if (dAppId && !this.isTxHash(dAppId)) {
        throw new IllegalArgumentException("The dAppId is invalid.")
      }
      this.defaultDAppId = dAppId
      resolve()
    })
  }

  private isHex(target: string): boolean {
    const re = /^[0-9A-Ffa-f]+$/g
    return re.test(target)
  }

  private isTxHash(target: string): boolean {
    const re = /[0-9A-Ffa-f]{64}/g
    return re.test(target)
  }

  // TODO: TEMP
  private checkWalletProvider = (): IWalletProvider => {
    if (!this.providers.walletProvider) {
      throw new ProviderException("")
    }
    return this.providers.walletProvider
  }

  // TODO: TEMP
  private checkNetworkProvider = (): INetworkProvider => {
    if (!this.providers.networkProvider) {
      throw new ProviderException("")
    }
    return this.providers.networkProvider
  }

  private isP2SHCashAddress = (address: string): boolean => {
    try {
      if (!isCashAddress(address) || !isP2SHAddress(address)) {
        return false
      }
    } catch (e) {
      return false
    }
    return true
  }

  private toAddressFromScript = (script: string) => {
    const buf = Buffer.from(script, "hex")
    const hashed = bitcoincashjs.crypto.Hash.sha256ripemd160(buf)
    const legacy = bitcoincashjs.Address.fromScriptHash(hashed).toString()
    return toCashAddress(legacy)
  }

  private async sendToOutputs(
    outputs: Output[],
    dAppId?: string
  ): Promise<string> {
    const walletProvider = this.checkWalletProvider()
    const rawtx = await walletProvider.createSignedTx(outputs, dAppId || this.defaultDAppId)
      .catch((e) => { throw new ProviderException(e) })
    if (typeof rawtx !== "string") {
      throw new ProviderException("The return value is invalid.")
    }
    const networkProvider = this.checkNetworkProvider()
    return networkProvider.broadcastRawTx(rawtx)
      .then((txid) => {
        if (typeof txid !== "string") {
          throw new ProviderException("The return value is invalid.")
        }
        return txid
      })
      .catch((e) => { throw new ProviderException(e) })
  }
}