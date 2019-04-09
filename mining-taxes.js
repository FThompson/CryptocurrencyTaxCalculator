'use strict'

/**
 * Represents a cryptocurrency transaction.
 */
class Transaction {
    /**
     * @param {Cryptocurrency} coin The cryptocurrency this transaction transfers.
     * @param {String} address The address searched in fetching this transaction.
     * @param {Number} realAmount The transaction amount in the smallest denomination of its currency.
     * @param {String} timestamp The full timestamp of when this transaction occurred.
     * @param {String} date The date on which this transaction occurred.
     * @param {String} hash This transaction's hash.
     */
    constructor(coin, address, realAmount, timestamp, date, hash) {
        this.coin = coin
        this.address = address
        this.realAmount = realAmount
        this.timestamp = timestamp
        this.date = date
        this.hash = hash
        this.amount = this.realAmount / this.coin.factor
    }

    /**
     * Queries Coinbase for the price of this transaction's currency on the given date.
     * 
     * @param {String} currency The currency code to retrieve the price in.
     */
    getPrice(currency = 'USD') {
        return this.coin.getCoinbasePrice(this.date, currency)
            .then(price => this._addPriceData(price))
            .catch(console.log)
    }

    /**
     * Adds price data to this transaction, calculating value when received.
     * 
     * @param {Number} price The price data to add to this transaction.
     */
    _addPriceData(price) {
        this.price = price
        this.valueWhenReceived = price * this.amount
        return this
    }
}

/**
 * Data class for blockchain explorer links.
 */
class Explorer {
    constructor(addressExplorer, txExplorer) {
        this.addressExplorer = addressExplorer
        this.txExplorer = txExplorer
    }
}

/**
 * Represents a cryptocurrency and functionality to lookup transactions.
 * 
 * This class is abstract; subclasses must implement `_getTransactions`.
 */
class Cryptocurrency {
    /**
     * @param {String} name The name of this cryptocurrency.
     * @param {String} code The shorthand code used on sites like Coinbase.
     * @param {Number} factor The factor for converting from the smallest resolution of this currency.
     * @param {Explorer} explorer The data object containing explorer links.
     * @param {Boolean} multiAddr `true` if this service accepts multi-address requests, `false` otherwise.
     */
    constructor(name, code, factor, explorer, multiAddr = false) {
        if (new.target === Cryptocurrency) {
            throw new TypeError('Cannot instantiate abstract class Cryptocurrency.')
        }
        this.name = name
        this.code = code
        this.factor = factor
        this.explorer = explorer
        this.multiAddr = multiAddr
    }

    /**
     * Fetches in transactions for the given address(es).
     * Must be implemented by subclasses.
     * 
     * @param {any} addressOrAddresses The address(es) to retrieve transactions for.
     *                                 `Array` if multi-address, `String` otherwise.
     */
    _getTransactions(addressOrAddresses) {
        throw new TypeError('Must implement abstract function getTransactions.')
    }

    /**
     * Returns an array of promises to retrieve transactions for the given addresses via this service.
     * 
     * @param {Array} addresses The addresses to build transaction promises for.
     * @param {String} currency The code for the currency to retrieve prices in. Default `USD`.
     */
    getTaxableEventPromises(addresses, currency = 'USD') {
        let promises = []
        let pricePromise = this.getCurrentCoinbasePrice(currency)
        if (this.multiAddr) {
            promises.push(this._getTaxableEvents(addresses, pricePromise, currency))
        } else {
            for (let address of addresses) {
                promises.push(this._getTaxableEvents(address, pricePromise, currency))
            }
        }
        return promises
    }

    /**
     * Gets the taxable events for the given addresses.
     * 
     * @param {any} addressOrAddresses The address or addresses to get taxable events for.
     * @param {Promise} pricePromise The price request wrapped in a promise.
     * @param {String} currency The currency code of the requested currency.
     */
    _getTaxableEvents(addressOrAddresses, pricePromise, currency) {
        return this._getTransactions(addressOrAddresses)
            .then(txns => {
                let txnPromises = txns.map(txn => txn.getPrice(currency))
                return Promise.all(txnPromises)
            })
            .then(txns => this._buildResult(txns, currency, pricePromise))
    }
    
    /**
     * Builds the result object containing currency info, transactions, and explorer links.
     * 
     * @param {Array[Transaction]} txns The transactions to build a result for.
     * @param {String} currency The currency code used.
     * @param {Promise} pricePromise The price request wrapped in a promise.
     */
    async _buildResult(txns, currency, pricePromise) {
        let result = {
            coin: {
                name: this.name,
                code: this.code,
                price: await pricePromise
            },
            currency: currency,
            amount: 0,
            value: 0,
            valueWhenReceived: 0,
            explorer: this.explorer,
            txns: txns
        }
        txns.forEach(txn => {
            result.amount += txn.amount
            result.valueWhenReceived += txn.valueWhenReceived
            txn.value = result.coin.price * txn.amount
            result.value += txn.value
        })
        return result
    }

    /**
     * Fetches the current price of this cryptocurrency.
     * 
     * @param {String} toCurrency The currency code to retrieve the price in.
     */
    getCurrentCoinbasePrice(toCurrency = 'USD') {
        return this.getCoinbasePrice(null, toCurrency)
    }
    
    /**
     * Fetches the price of this cryptocurrency on the given date via Coinbase.
     * 
     * @param {String} date The date to retrieve the price for.
     * @param {String} toCurrency The currency code to retrieve the price in.
     */
    getCoinbasePrice(date, toCurrency = 'USD') {
        let url = sprintf(date !== null ? priceEndpoint + "?date=%s" : priceEndpoint, this.code, toCurrency, date)
        return fetch(url, { headers: priceHeaders })
            .then(response => response.json())
            .then(json => json.data.amount)
            .catch(console.log)
    }
}

class Bitcoin extends Cryptocurrency {
    constructor() {
        super('Bitcoin', 'BTC', 1e8, BITCOIN_EXPLORER, true)
    }

    /**
     * Retrieves Bitcoin transactions from https://blockchain.info for the given addresses.
     */
    _getTransactions(addresses, data = [], offset = 0) {
        return fetch(sprintf(btcEndpoint, addresses.join('|'), offset))
            .then(response => response.json())
            .then(json => {
                let txLength = json.txs.length
                for (let i = 0; i < txLength; i++) {
                    let result = json.txs[i].result
                    if (result > 0) {
                        let address = json.txs[i].out[0].addr
                        let realAmount = result
                        let timestamp = json.txs[i].time
                        let date = getDateFromSeconds(timestamp)
                        let hash = json.txs[i].hash
                        let tx = new Transaction(this, address, realAmount, timestamp, date, hash)
                        data.push(tx)
                    }
                }
                let txProcessed = offset + txLength
                if (json.wallet.n_tx > txProcessed) { // more txs exist
                    return Promise.resolve(this._getTransactions(addresses, data, txProcessed))
                }
                return data
            }).catch(console.log)
    }
}

class Litecoin extends Cryptocurrency {
    constructor() {
        super('Litecoin', 'LTC', 1e8, LITECOIN_EXPLORER)
    }

    /**
     * Retrieves Litecoin transactions from https://live.blockcypher.com for the given address.
     */
    _getTransactions(address, data = [], offset = 0) {
        let url = sprintf(ltcEndpoint, address)
        if (offset > 0) {
            url += '&before=' + offset
        }
        return fetch(url)
            .then(response => response.json())
            .then(json => {
                let lastBlock = -1
                for (let i = 0; i < json.txrefs.length; i++) {
                    if (json.txrefs[i].spent === false) {
                        let realAmount = json.txrefs[i].value
                        let timestamp = json.txrefs[i].confirmed
                        let date = timestamp.substring(0, 10)
                        let hash = json.txrefs[i].tx_hash
                        let tx = new Transaction(this, address, realAmount, timestamp, date, hash)
                        data.push(tx)
                    }
                    lastBlock = json.txrefs[i].block_height
                }
                if (json.hasMore) {
                    return Promise.resolve(this._getTransactions(address, data, lastBlock))
                }
                return data
            }).catch(console.log)
    }
}

class Ethereum extends Cryptocurrency {
    constructor() {
        super('Ethereum', 'ETH', 1e18, ETHEREUM_EXPLORER)
    }

    /**
     * Retrieves Ethereum transactions from https://etherscan.io for the given address.
     */
    _getTransactions(address) {
        return fetch(sprintf(ethEndpoint, address, config.apiKeys.etherscan))
            .then(response => response.json())
            .then(json => {
                let data = []
                for (let i = 0; i < json.result.length; i++) {
                    if (json.result[i].to === address) {
                        let realAmount = json.result[i].value
                        let timestamp = json.result[i].timeStamp
                        let date = getDateFromSeconds(timestamp)
                        let hash = json.result[i].hash
                        let tx = new Transaction(this, address, realAmount, timestamp, date, hash)
                        data.push(tx)
                    }
                }
                return data
            }).catch(console.log)
    }
}

const priceEndpoint = 'https://api.coinbase.com/v2/prices/%s-%s/spot'
const priceHeaders = { 'CB-VERSION': '2018-02-12'}
const btcEndpoint = 'https://blockchain.info/multiaddr?active=%s&n=100&offset=%s'
const ltcEndpoint = 'https://api.blockcypher.com/v1/ltc/main/addrs/%s?limit=2000&omitWalletAddresses=true'
const ethEndpoint = 'http://api.etherscan.io/api?module=account&action=txlist&address=%s&apikey=%s&sort=desc'

const BITCOIN_EXPLORER = new Explorer('https://blockchain.info/address/', 'https://blockchain.info/tx/')
const LITECOIN_EXPLORER = new Explorer('https://live.blockcypher.com/ltc/address/', 'https://live.blockcypher.com/ltc/tx/')
const ETHEREUM_EXPLORER = new Explorer('https://etherscan.io/address/', 'https://etherscan.io/tx/')

// supported cryptocurrencies
const coins = {
    'bitcoin': new Bitcoin(),
    'litecoin': new Litecoin(),
    'ethereum': new Ethereum()
}

const fs = require('fs')
const fetch = require('node-fetch')
const sprintf = require('sprintf-js').sprintf

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
if (require.main === module) {
    // load config and retrieve taxable events for addresses supplied in config, printing results
    let promises = Object.keys(config.addresses)
        .map(coin => coins[coin].getTaxableEventPromises(config.addresses[coin]))
    promises = [].concat(...promises)  // flatten promises
    Promise.all(promises).then(printResults).catch(console.log)
}

/**
 * Prints the results object containing transactions from multiple currencies in csv form.
 * @param {Object} results The results object containing transactions and currency info.
 */
function printResults(results) {
    // console.log(JSON.stringify(results, null, 4))
    console.log('Coin,Code,Date,Price,Amount,Value When Received,Address,Transaction')
    results.forEach(crypto => {
        // console.log('Total ' + crypto.coin.name + ' mined: ' + crypto.amount)
        // console.log('Current value: $' + crypto.value)
        // console.log('Taxable income: $' + crypto.valueWhenReceived)
        crypto.txns.forEach(txn => {
            let data = [crypto.coin.name, crypto.coin.code, txn.date, txn.price, txn.amount, txn.valueWhenReceived, txn.address, txn.hash]
            console.log(data.join(','))
        })
    })
}

/**
 * Converts the given number of seconds into a date.
 */
function getDateFromSeconds(seconds) {
    let date = new Date(seconds * 1000)
    let format = "%d-%02d-%02d"
    return sprintf(format, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}