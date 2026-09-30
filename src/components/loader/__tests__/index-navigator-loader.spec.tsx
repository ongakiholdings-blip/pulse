import { act, render, screen } from '@testing-library/react';
import IndexNavigatorLoader from '../index-navigator-loader';

describe('IndexNavigatorLoader', () => {
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('renders the live trading scene and six updating market cards', () => {
        const { container } = render(<IndexNavigatorLoader />);

        expect(screen.getAllByText('DBOTPULSE')).toHaveLength(2);
        expect(screen.getByText('POWERED BY DERIV')).toBeInTheDocument();
        expect(container.querySelectorAll('.index-navigator-loader__market')).toHaveLength(6);
        expect(container.querySelectorAll('.index-navigator-loader__candle')).toHaveLength(16);
        expect(screen.getByRole('progressbar', { name: 'Loading trading workspace' })).toHaveAttribute(
            'aria-valuenow',
            '0'
        );
    });

    it('marks the loader for its exit transition when startup is complete', () => {
        const { container } = render(<IndexNavigatorLoader isInitializing={false} isExiting />);

        expect(container.querySelector('.index-navigator-loader')).toHaveClass('index-navigator-loader--exiting');
        expect(container.querySelector('.index-navigator-loader')).toHaveAttribute('aria-busy', 'false');
    });

    it('updates market values and completes the loading sequence', () => {
        jest.useFakeTimers();
        jest.spyOn(Math, 'random').mockReturnValue(1);
        render(<IndexNavigatorLoader />);

        act(() => {
            jest.advanceTimersByTime(1200);
        });
        expect(screen.getByText('▲ 0.46%')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Loading trading workspace' })).toHaveAttribute(
            'aria-valuenow',
            '30'
        );

        act(() => {
            jest.advanceTimersByTime(2800);
        });
        expect(screen.getByText('ACCESS GRANTED')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Loading trading workspace' })).toHaveAttribute(
            'aria-valuenow',
            '100'
        );
    });
});
