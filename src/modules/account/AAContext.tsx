'use client'

import React, {ReactNode, useCallback, useContext, useEffect, useMemo, useReducer, useState} from 'react'
import {ConnectModal} from '@m/account/ConnectModal'
import {Web3AuthNoModal} from "@web3auth/no-modal";
import {EthereumPrivateKeyProvider} from "@web3auth/ethereum-provider";
import {OpenloginAdapter} from "@web3auth/openlogin-adapter";
import {CustomChainConfig, WALLET_ADAPTERS} from "@web3auth/base";
import {getPublicCompressed} from "@toruslabs/eccrypto";

import aaConfig from "@config/aa.config";
import SimpleAccount from "@m/aa/SimpleAccount";

import RPC from "@utils/ethersRPC";
import localStore from "@utils/localStore";

const AAContext = React.createContext<any>({
})

export const AAContextProvider = ({children}: { children: ReactNode }) => {
    const initalState: any = {
        isConnectModalOpen: false,
        user: {},
        status: '', // connected
        accounts: {}
    }
    const [web3auth, setWeb3auth] = useState<Web3AuthNoModal | null>(null);

    const chainConfig: CustomChainConfig = {
        chainNamespace: "eip155",
        chainId: "0x1",
        rpcTarget: "https://rpc.ankr.com/eth",
        displayName: "Ethereum Mainnet",
        blockExplorer: "https://etherscan.io",
        ticker: "ETH",
        tickerName: "Ethereum",
    };

    const reducer = (state: any, action: any) => {
        switch (action.type) {
            case 'OPEN_CONNECT_MODAL': {
                console.log('OPEN_CONNECT_MODAL')
                return {...state, isConnectModalOpen: true}
            }
            case 'CLOSE_CONNECT_MODAL': {
                console.log('CLOSE_CONNECT_MODAL')
                return {...state, isConnectModalOpen: false}
            }
            case 'UPDATE_USER_INFO': {
                return {...state, user: action.data, status: 'connected'}
            }
            case 'LOGOUT': {
                return {...state, user: {}, status: ''}
            }
            case 'UPDATE_STATUS': {
                // todo update related data fields
                return {...state, status: action.status}
            }
            case 'UPDATE_ACCOUNTS': {
                // todo update related data fields
                return {...state, accounts: action.accounts}
            }
            default:
                return {...state}
        }
    }
    const [state, dispatch] = useReducer(reducer, initalState)

    const connectWeb3Auth = useCallback(async () => {
        console.log('login', web3auth)
        if (web3auth) {
            await web3auth.connectTo(WALLET_ADAPTERS.OPENLOGIN, {
                loginProvider: "twitter",
            });
        }
    }, [web3auth])

    const login = useCallback(async () => {
        console.log('login web3auth', web3auth)

        if (!web3auth) {
            console.error('web3auth not inited')
            return
        }
        if (!web3auth.connected) {
            console.log('need to connect web3auth')
            await connectWeb3Auth()
        }
        if (!web3auth.provider) {
            console.error('web3auth.provider not exists')
            return
        }

        await verifyFromServer()

    }, [web3auth, connectWeb3Auth])

    const verifyFromServer = useCallback(async ()=>{
        if(!web3auth?.provider || !web3auth.connected){
            console.error('VERIFY_WEB3AUTH_NOT_CONNECTED')
            return
        }

        try {
            const rpc = new RPC(web3auth.provider);
            const app_scoped_privkey = await web3auth?.provider?.request({
                method: "eth_private_key", // use "private_key" for other non-evm chains
            }) as string;
            const app_pub_key = getPublicCompressed(Buffer.from(app_scoped_privkey?.padStart(64, "0"), "hex")).toString("hex");

            console.log('app_pub_key', app_pub_key)

            const user = await web3auth?.getUserInfo();
            const address = await rpc.getAccounts();

            console.log('start request:', user, address)

            const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/auth/verify`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + user?.idToken, // or token.idToken
                },
                body: JSON.stringify({
                    appPubKey: app_pub_key,
                    // idToken:user?.idToken,
                    // idTokenSigned:idTokenSigned,
                    // address
                }),
            });

            console.log('end request')

            const data = await res.json()
            console.log('res', res, res.body, data)

            localStorage.setItem('user', JSON.stringify(data))
            dispatch({
                type: 'UPDATE_USER_INFO',
                data
            })
            // check refresh UI

        } catch (e) {
            console.log('login error:')
            console.error('login error', e)
        }

    },[web3auth])

    const logout = useCallback(async () => {
        await localStorage.removeItem('user')
        await web3auth?.logout()
    }, [web3auth])

    const getUserInfo = useCallback(async () => {
        const user = await web3auth?.getUserInfo();
        console.log('getUserInfo', user)
    }, [web3auth])


    const refreshLoginStatus = useCallback(async () => {
        const status = web3auth?.connected
        console.log('refreshWeb3authStatus', status)

        if (status) {
            dispatch({
                type: 'UPDATE_STATUS',
                status: 'connected'
            })
        } else {
            dispatch({
                type: 'UPDATE_STATUS',
                status: 'disconnected'
            })
            logout()
            return
        }

        // check access_token

        const accessToken = await localStore.getAccessToken()
        if(!accessToken){
           await verifyFromServer()
        }

    }, [web3auth])


    const initAccounts = useCallback(async (privateKey: string) => {
        const accounts: any = {}
        for (let key in aaConfig) {
            accounts[key] = new SimpleAccount()
            await accounts[key].init(privateKey, aaConfig[key])
        }
        dispatch({
            type: 'UPDATE_ACCOUNTS',
            accounts
        })

    }, [web3auth])

    useEffect(() => {
        const init = async () => {
            try {
                const web3auth = new Web3AuthNoModal({
                    clientId: process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID || '',
                    chainConfig,
                });

                const privateKeyProvider = new EthereumPrivateKeyProvider({config: {chainConfig}});

                const openloginAdapter = new OpenloginAdapter({
                    privateKeyProvider,
                });
                web3auth.configureAdapter(openloginAdapter);

                setWeb3auth(web3auth);

                await web3auth.init();

                console.log('after web3auth init', web3auth.connected)

                // get user info from local storage
                const strUser = localStorage.getItem('user')
                if (strUser) {
                    try {
                        const user = JSON.parse(strUser)
                        dispatch({
                            type: 'UPDATE_USER_INFO',
                            data: user
                        })
                    } catch (e) {
                        localStorage.removeItem('user')
                        dispatch({
                            type: 'LOGOUT',
                        })
                        console.log('local user parse error')
                    }
                }

                // check web3auth and verify status
                refreshLoginStatus()

            } catch (error) {
                console.error(error);
            }
        };
        init();
    }, []);

    // init accounts
    useEffect(() => {
         console.log('initAccounts start',web3auth?.connected ,web3auth?.provider)
        const init = async () => {
            if (!web3auth?.connected || !web3auth?.provider) return

            const rpc = new RPC(web3auth.provider);
            const app_scoped_privkey = await web3auth?.provider?.request({
                method: "eth_private_key", // use "private_key" for other non-evm chains
            }) as string;

            // init accounts
            await initAccounts(app_scoped_privkey)
        }
        init()

    }, [web3auth?.connected])


    const contextValue = useMemo(
        () => ({
            state,
            dispatch,
            login,
            logout,
            getUserInfo
        }),
        [state, dispatch, login, logout, getUserInfo]
    );

    return <AAContext.Provider value={contextValue}>
        {children}
        <ConnectModal/>
    </AAContext.Provider>
}

export const useAAContext = () => useContext(AAContext);
