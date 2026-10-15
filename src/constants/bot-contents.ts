type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    FREE_BOTS: 2,
    BULK_TRADER: 3,
    SIGNAL_ZONE: 4,
    PULSE_SCANNER: 5,
    SCANNER: 6,
    MATCHES_HUB: 7,
    CHART: 8,
    DERIV_T_VIEW: 9,
    COPY_TRADING: 10,
    ANALYSIS: 11,
    TUTORIAL: 12,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-free-bots',
    'id-bulk-trader',
    'id-signal-zone',
    'id-pulse-scanner',
    'id-scanner',
    'id-matches-hub',
    'id-charts',
    'id-deriv-t-view',
    'id-copy-trading',
    'id-analysis',
    'id-tutorials',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
