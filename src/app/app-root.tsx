import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import IndexNavigatorLoader from '@/components/loader/index-navigator-loader';
import './app-root.scss';

const AppContent = lazy(() => import('./app-content'));
const MIN_LOADER_DURATION_MS = 4400;
const LOADER_EXIT_DURATION_MS = 450;

const ErrorComponentWrapper = observer(() => {
    const { common } = useStore();

    if (!common.error) return null;

    return (
        <ErrorComponent
            header={common.error?.header}
            message={common.error?.message}
            redirect_label={common.error?.redirect_label}
            redirectOnClick={common.error?.redirectOnClick}
            should_clear_error_on_click={common.error?.should_clear_error_on_click}
            setError={common.setError}
            redirect_to={common.error?.redirect_to}
            should_redirect={common.error?.should_redirect}
        />
    );
});

const AppRoot = () => {
    const store = useStore();
    const api_base_initialized = useRef(false);
    const [is_api_initialized, setIsApiInitialized] = useState(false);
    const [is_loader_visible, setIsLoaderVisible] = useState(true);
    const [is_loader_exiting, setIsLoaderExiting] = useState(false);

    useEffect(() => {
        const loaderStartedAt = Date.now();
        let loaderTimer: ReturnType<typeof setTimeout> | undefined;
        let exitTimer: ReturnType<typeof setTimeout> | undefined;
        const scheduleLoaderDismissal = () => {
            const remainingDuration = Math.max(0, MIN_LOADER_DURATION_MS - (Date.now() - loaderStartedAt));
            loaderTimer ??= setTimeout(() => {
                setIsLoaderExiting(true);
                exitTimer = setTimeout(() => setIsLoaderVisible(false), LOADER_EXIT_DURATION_MS);
            }, remainingDuration);
        };
        const timeoutId = setTimeout(() => {
            if (!is_api_initialized) {
                setIsApiInitialized(true);
                scheduleLoaderDismissal();
            }
        }, 5000);

        const initializeApi = async () => {
            if (!api_base_initialized.current) {
                try {
                    await api_base.init();
                    api_base_initialized.current = true;
                } catch (error) {
                    console.error('API initialization failed:', error);
                    api_base_initialized.current = false;
                } finally {
                    setIsApiInitialized(true);
                    scheduleLoaderDismissal();
                    clearTimeout(timeoutId);
                }
            }
        };

        initializeApi();
        return () => {
            if (loaderTimer) clearTimeout(loaderTimer);
            if (exitTimer) clearTimeout(exitTimer);
            clearTimeout(timeoutId);
        };
    }, []);

    if (!store || !is_api_initialized || is_loader_visible) {
        return <IndexNavigatorLoader isInitializing={!is_api_initialized} isExiting={is_loader_exiting} />;
    }

    return (
        <Suspense fallback={<IndexNavigatorLoader />}>
            <ErrorBoundary root_store={store}>
                <ErrorComponentWrapper />
                <AppContent />
            </ErrorBoundary>
        </Suspense>
    );
};

export default AppRoot;
