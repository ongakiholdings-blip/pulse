// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import NoSearchResult from './common/no-search-result-found';
import SearchInput from './common/search-input';
import QuickStrategyGuides from './quick-strategy-content/quick-strategy-guides';
import FAQContent from './faq-content';
import GuideContent from './guide-content';
import { LabelPairedSearchSmRegularIcon } from '@deriv/quill-icons/LabelPaired';

const DERIV_AFFILIATE_URL = 'https://t.deriv.link?t=DGSGSFMT3L38';
const CONTACT_WHATSAPP_URL = 'https://wa.me/+254115335502';
const CONTACT_TELEGRAM_URL = 'https://t.me/index_navigator';

type TTutorialsTab = {
    handleTabChange: (active_number: number) => void;
};

const TutorialsTab = observer(({ handleTabChange }: TTutorialsTab) => {
    const { dashboard } = useStore();
    const {
        active_tab_tutorials,
        faq_search_value,
        guide_tab_content,
        video_tab_content,
        faq_tab_content,
        quick_strategy_tab_content,
        is_dialog_open,
        setActiveTabTutorial,
    } = dashboard;

    const tabs = [
        localize('Tutorials'),
        localize('FAQs'),
        localize('Quick guides'),
        localize('Our Affiliate'),
    ];
    const hasContent =
        guide_tab_content().length > 0 ||
        video_tab_content().length > 0 ||
        faq_tab_content().length > 0 ||
        quick_strategy_tab_content().length > 0;

    return (
        <div className='tutorials-page'>
            <header className='tutorials-page__sidebar'>
                <div className='tutorials-page__heading'>
                    <span className='tutorials-page__eyebrow'>DBOTPULSE LEARNING CENTER</span>
                    <h1>Learn at your own pace</h1>
                    <p>Explore tutorials, quick guides, answers, and affiliate information.</p>
                </div>
                <div className='tutorials-page__search'>
                    <LabelPairedSearchSmRegularIcon width='16px' height='16px' />
                    <SearchInput
                        faq_value={faq_search_value}
                        setFaqSearchContent={dashboard.setFAQSearchValue}
                        prev_active_tutorials={active_tab_tutorials}
                    />
                </div>
                <nav className='tutorials-page__nav' aria-label='Learning center sections'>
                    {tabs.map((label, index) => {
                        const isActive =
                            (index < 3 && index === active_tab_tutorials) ||
                            (index === 3 && active_tab_tutorials === 4);
                        return (
                            <button
                                aria-pressed={isActive}
                                className={
                                    isActive
                                        ? 'tutorials-page__nav-item tutorials-page__nav-item--active'
                                        : 'tutorials-page__nav-item'
                                }
                                key={label}
                                onClick={() => setActiveTabTutorial(index === 3 ? 4 : index)}
                                type='button'
                            >
                                {label}
                            </button>
                        );
                    })}
                </nav>
            </header>

            <main className='tutorials-page__content'>
                {active_tab_tutorials === 0 ? (
                    <GuideContent
                        guide_tab_content={guide_tab_content()}
                        video_tab_content={video_tab_content()}
                        is_dialog_open={is_dialog_open}
                    />
                ) : active_tab_tutorials === 1 ? (
                    <FAQContent faq_list={faq_tab_content()} handleTabChange={handleTabChange} />
                ) : active_tab_tutorials === 2 ? (
                    <QuickStrategyGuides quick_strategy_tab_content={quick_strategy_tab_content()} />
                ) : active_tab_tutorials === 4 ? (
                    <section className='affiliate-hub' aria-labelledby='affiliate-hub-title'>
                        <div className='affiliate-hub__intro'>
                            <span className='affiliate-hub__eyebrow'>PARTNER INFORMATION</span>
                            <h2 id='affiliate-hub-title'>Our Deriv affiliate</h2>
                            <p>
                                Learn about Deriv’s affiliate programme and find the official place to explore
                                eligibility, commissions, and terms.
                            </p>
                        </div>
                        <div className='affiliate-hub__cards'>
                            <article className='affiliate-hub__card'>
                                <span className='affiliate-hub__card-number'>01</span>
                                <h3>How it works</h3>
                                <p>
                                    Affiliates share a tracked referral link. Approved partners may receive
                                    commission for eligible client activity under Deriv’s programme rules.
                                </p>
                            </article>
                            <article className='affiliate-hub__card'>
                                <span className='affiliate-hub__card-number'>02</span>
                                <h3>Know the terms</h3>
                                <p>
                                    Eligibility, commission models, and payment conditions can vary. Review the
                                    current official terms before applying or promoting any offer.
                                </p>
                            </article>
                            <article className='affiliate-hub__card affiliate-hub__card--note'>
                                <span className='affiliate-hub__card-number'>03</span>
                                <h3>Promote responsibly</h3>
                                <p>
                                    Trading involves risk and losses are possible. Never promise profits, and
                                    clearly disclose your affiliate relationship when sharing a referral link.
                                </p>
                            </article>
                        </div>
                        <div className='affiliate-hub__actions'>
                            <a href={DERIV_AFFILIATE_URL} target='_blank' rel='noreferrer'>
                                Explore Deriv’s affiliate programme <span aria-hidden='true'>↗</span>
                            </a>
                            <a
                                className='affiliate-hub__contact'
                                href={CONTACT_WHATSAPP_URL}
                                target='_blank'
                                rel='noreferrer'
                            >
                                Contact us
                            </a>
                            <a
                                className='affiliate-hub__community'
                                href={CONTACT_TELEGRAM_URL}
                                target='_blank'
                                rel='noreferrer'
                            >
                                Join the community
                            </a>
                        </div>
                    </section>
                ) : active_tab_tutorials === 3 && hasContent ? (
                    <>
                        <GuideContent
                            guide_tab_content={guide_tab_content()}
                            video_tab_content={video_tab_content()}
                            is_dialog_open={is_dialog_open}
                        />
                        <FAQContent faq_list={faq_tab_content()} handleTabChange={handleTabChange} />
                        <QuickStrategyGuides quick_strategy_tab_content={quick_strategy_tab_content()} />
                    </>
                ) : (
                    <NoSearchResult />
                )}
            </main>
        </div>
    );
});

export default TutorialsTab;
