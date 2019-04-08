'use strict'

const priceEndpoint = 'https://api.coinbase.com/v2/prices/%s-%s/spot'
const priceHeaders = { 'CB-VERSION': '2018-02-12'}
const btcEndpoint = 'https://blockchain.info/multiaddr?active=%s&n=100&offset=%s'
const ltcEndpoint = 'https://api.blockcypher.com/v1/ltc/main/addrs/%s?limit=2000&omitWalletAddresses=true'
const ethEndpoint = 'http://api.etherscan.io/api?module=account&action=txlist&address=%s&apikey=%s&sort=desc'

const coins = {
    'bitcoin': {
        getTransactions: getBitcoinTransactions,
        name: 'Bitcoin',
        code: 'BTC',
        factor: 1e8,
        multiAddr: true,
        explorer: {
            address: 'https://blockchain.info/address/',
            tx: 'https://blockchain.info/tx/'
        }
    },
    'litecoin': {
        getTransactions: getLitecoinTransactions,
        name: 'Litecoin',
        code: 'LTC',
        factor: 1e8,
        multiAddr: false,
        explorer: {
            address: 'https://live.blockcypher.com/ltc/address/',
            tx: 'https://live.blockcypher.com/ltc/tx/'
        }
    },
    'ethereum': {
        getTransactions: getEthereumTransactions,
        name: 'Ethereum',
        code: 'ETH',
        factor: 1e18,
        multiAddr: false,
        explorer: {
            address: 'https://etherscan.io/address/',
            tx: 'https://etherscan.io/tx/'
        }
    }
}

const fs = require('fs')
const fetch = require('node-fetch')
const sprintf = require('sprintf-js').sprintf

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
Promise.all(getIncomePromises()).then(printResults).catch(console.log)

class Transaction {
    constructor(coin, address, realAmount, timestamp, date, hash) {
        this.coin = coin
        this.address = address
        this.realAmount = realAmount
        this.timestamp = timestamp
        this.date = date
        this.hash = hash
    }

    getTransactionPrice(currency = 'USD') {
        return getCoinbasePrice(this.date, this.coin.code, currency)
            .then(price => this._addPriceData(price))
            .catch(console.log)
    }

    _addPriceData(price) {
        this.price = price
        this.amount = this.realAmount / this.coin.factor
        this.valueWhenReceived = price * this.amount
        return this
    }
}

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

function getIncomePromises() {
    let promises = []
    for (let coin in config.addresses) {
        if (coins[coin].multiAddr) {
            promises.push(getTaxableIncome(config.addresses[coin], coin))
        } else {
            for (let address of config.addresses[coin]) {
                promises.push(getTaxableIncome(address, coin))
            }
        }
    }
    return promises
}

function getTaxableIncome(address, coinName, currency = 'USD') {
    let coin = coins[coinName]
    let pricePromise = getCurrentCoinbasePrice(coin.code, currency)
    return coin.getTransactions(coin, address)
        .then(txns => {
            let txnPromises = txns.map(txn => txn.getTransactionPrice(currency))
            return Promise.all(txnPromises)
        })
        .then(txns => buildResult(txns, coin, currency, pricePromise))
        .catch(console.log)
}

async function buildResult(txns, coin, currency, pricePromise) {
    let result = {
        coin: {
            name: coin.name,
            code: coin.code,
            price: await pricePromise
        },
        currency: currency,
        amount: 0,
        value: 0,
        valueWhenReceived: 0,
        explorer: coin.explorer,
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

function getBitcoinTransactions(coin, addresses, data = [], offset = 0) {
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
                    let tx = new Transaction(coin, address, realAmount, timestamp, date, hash)
                    data.push(tx)
                }
            }
            let txProcessed = offset + txLength
            if (json.wallet.n_tx > txProcessed) { // more txs exist
                return Promise.resolve(getBitcoinTransactions(addresses, data, txProcessed))
            }
            return data
        }).catch(console.log)
}

function getLitecoinTransactions(coin, address, data = [], offset = 0) {
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
                    let tx = new Transaction(coin, address, realAmount, timestamp, date, hash)
                    data.push(tx)
                }
                lastBlock = json.txrefs[i].block_height
            }
            if (json.hasMore) {
                return Promise.resolve(getLitecoinTransactions(address, data, lastBlock))
            }
            return data
        }).catch(console.log)
}

function getEthereumTransactions(coin, address) {
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
                    let tx = new Transaction(coin, address, realAmount, timestamp, date, hash)
                    data.push(tx)
                }
            }
            return data
        }).catch(console.log)
}

function getCurrentCoinbasePrice(fromCurrency, toCurrency = 'USD') {
    return getCoinbasePrice(null, fromCurrency, toCurrency)
}

function getCoinbasePrice(date, fromCurrency, toCurrency = 'USD') {
    let url = sprintf(date !== null ? priceEndpoint + "?date=%s" : priceEndpoint, fromCurrency, toCurrency, date)
    return fetch(url, { headers: priceHeaders })
        .then(response => response.json())
        .then(json => json.data.amount)
        .catch(console.log)
}

function getDateFromSeconds(seconds) {
    let date = new Date(seconds * 1000)
    let format = "%d-%02d-%02d"
    return sprintf(format, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}