---
permalink: /
title: ""
excerpt: "Welcome"
author_profile: true
redirect_from:
  - /about/
  - /about.html
---

<style>
  /* Base styles */
:root {
  --navy: #DF8820;
  --gold: #2077DF;
  --seagreen: #3BC491; 
  --white: #ffffff;
  --gray: #f5f5f5;
  --text: #2c3e50;
}

body {
  font-family: "Source Sans Pro", sans-serif;
  line-height: 1.8;
  color: var(--text);
  background: var(--white);
}

h1, h2, h3 {
  font-family: "Source Sans Pro", sans-serif; /* "Crimson Text", serif; */ 
  color: var(--navy);
  letter-spacing: -0.02em;
}

/* Header & Navigation */
.masthead {
  background: white;
  box-shadow: 0 0px 0px rgba(0,0,0,0.1);
  padding: 1rem 0;
}

.masthead__menu-item a {
  color: var(--navy);
  font-weight: 500;
  transition: color 0.2s;
}

.masthead__menu-item a:hover {
  color: var(--gold);
}

/* Content */
.page__content {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}

/* Links */
a {
  color: var(--gold); 
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s;
}

a:hover {
  border-color: var(--gold);
}

/* Publications */
.publication-title {
  color: #2a9d8f: /* var(--gold); */ 
  font-size: 1.2em;
  margin: 1.5em 0 0.5em;
}

.publication-abstract {
  padding: 0.2rem 0;
  margin: 0.2rem 0;
  color: #4a5568;
  line-height: 1;
  /* Remove box styling */
  background: transparent;
  box-shadow: none;
  border-radius: 0;
} 

.publication-abstract summary {
  cursor: pointer;
  color: #2563eb;
  font-weight: 100;
} 

/* Responsive */
@media (max-width: 768px) {
  .page__content {
    padding: 1rem;
  }
} 
</style>

Welcome! I am an associate professor of economics at the [University of Bergen](https://www.uib.no/econ]), Norway, and an associate member of the Bergen Center for Competition Law and Economics \([BECCLE](https://beccle.no/)\). 

My research focuses on economic themes across Fintech, Blockchain & Cryptocurrencies, Capital Markets, Corporate Finance, and Industrial Organization using big data and cutting-edge computational techniques like natural language processing. Most of my analyses are conducted using R, Python, and SQL. Additionally, I teach two final-year undergraduate courses: [ITØK264: Financial Technology](https://www.uib.no/emne/IT%C3%98K264), and [ECON261: Finance & Investments](https://www4.uib.no/en/courses/econ261) 

I earned my PhD in applied economics from [Ghent University](https://www.ugent.be/eb/en), Belgium, in 2017, and spent two years as a Barclays research fellow in finance at the [Saïd Business School](https://www.sbs.ox.ac.uk/), [University of Oxford](https://www.ox.ac.uk/). 

[Please find my CV here](https://adivakaruni.github.io/files/cv_oct24.pdf). I can be reached at [anantha.divakaruni@uib.no](anantha.divakarun@uib.no). 

### Mailing address:  
Room 314, Institutt for Økonomi,  
University of Bergen,  
Postboks 7802  
5020 Bergen NORWAY  


### PUBLICATIONS

3.  <span class="publication-title">**Uncovering Retail Trading in Bitcoin: The Impact of COVID-19 Stimulus Checks**</span>
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        In April 2020, the US government sent economic impact payments (EIPs) directly to households, as part of its measures to address the COVID-19 pandemic. We characterize these stimulus checks as a wealth shock for households and examine their effect on retail trading in Bitcoin. We find a significant increase in Bitcoin buy trades for the modal EIP amount of $1,200. The rise in Bitcoin trading is highest among individuals without families and at exchanges catering to nonprofessional investors. We estimate that the EIP program has a significant but modest effect on the US dollar–Bitcoin trading pair, increasing trade volume by about 3.8 percent. Trades associated with the EIPs result in a slight rise in the price of Bitcoin of 7 basis points. Nonetheless, the increase in trading is small compared to the size of the stimulus check program, representing only 0.02 percent of all EIP dollars. We repeat our analysis for other countries with similar stimulus programs and find an increase in Bitcoin buy trades in these currencies. Our findings highlight how wealth shocks affect retail trading.
    </details>
      with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)  
      <span style="color:seagreen">*Management Science*</span>  
      Latest version: February 2023. First version: July 2021.  
      \[[SSRN](https://papers.ssrn.com/abstract=3888393)] \[[Cleveland Fed WP](https://www.clevelandfed.org/publications/working-paper/2021/wp-2113-impact-of-covid19-stimulus-checks-on-retail-trading-in-bitcoin)] \[[Published version](https://shorturl.at/ikFNZ)]  
      <span style="color:seagreen">*Media Coverage:*</span> \[[Bloomberg](https://www.bloomberg.com/news/articles/2022-08-26/bitcoin-price-drop-underscores-crypto-s-overstated-value)] \[[Atlantic](https://www.theatlantic.com/ideas/archive/2022/11/black-investors-bitcoin-cryptocurrency-crash/671750/)] \[[Motley Fool](https://www.fool.com/the-ascent/cryptocurrency/articles/did-stimulus-checks-increase-bitcoin-trading/)] \[[CoinDesk](https://www.coindesk.com/markets/2021/07/16/covid-19-stimulus-checks-fueled-modest-jump-in-bitcoin-price-last-year-cleveland-fed/)] \[[Coin Bureau](https://www.youtube.com/watch?v=9sBVMwP9uoE&ab_channel=CoinBureau)]  

2.  <span class="publication-title">**The Lightning Network: Turning Bitcoin into Money**</span>  
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        The Lightning Network (LN) is a means of netting Bitcoin payments outside the blockchain. We find a significant association between LN adoption and reduced blockchain congestion, suggesting that the LN has helped improve the efficiency of Bitcoin as a means of payment. This improvement cannot be explained by other factors, such as changes in demand or the adoption of SegWit. We find mixed evidence on whether increased centralisation in the Lightning Network has improved its efficiency. Our findings have implications for the future of cryptocurrencies as a means of payment and their environmental footprint.
    </details>
      with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)  
      <span style="color:seagreen">*Finance Research Letters, vol.52, no.103480, 2022*</span>  
      Latest version: June 2022. First version: January 2020.  
      \[[SSRN](https://papers.ssrn.com/abstract=4142590)] \[[Cleveland Fed WP](https://fedinprint.org/item/fedcwq/94363/original)] \[[Published version](https://www.sciencedirect.com/science/article/abs/pii/S1544612322006560)]  
      <span style="color:seagreen">*Media Coverage:*</span> \[[Bitcoin Magazine](https://bitcoinmagazine.com/markets/united-states-will-back-dollar-with-bitcoin)] \[[CoinGeek](https://coingeek.com/btc-lightning-network-it-still-doesnt-work-but-does-anyone-notice/)]  

1.  <span class="publication-title">**Lending When Relationships Are Scarce: The Role of Information Spread via Bank Networks**</span>  
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        We investigate how information flows within bank networks facilitate syndicate formation and lending in the leveraged buyout (LBO) market, where relationships between banks and borrowers are scarce and borrower opacity is high. Using novel measures that characterize a bank's ability to source and disseminate information within its loan syndication network, we show that the extent of this capability influences which banks join the syndicate, the share the lead bank holds, and LBO borrowing terms. Banks' ability to source and disseminate network-based information is particularly useful when ties to prospective borrowers are lacking, with the information flows extending beyond knowledge on PE firms and LBO targets.
    </details>
      with [Yan Alperovych](https://em-lyon.com/en/yan-alperovych/briefly) and [Sophie Manigart](https://www.vlerick.com/en/find-faculty-and-experts/sophie-manigart/)  
      <span style="color:seagreen">*Journal of Corporate Finance, vol.73, no.102181, 2022*</span>  
      Latest version: March 2022. First version: October 2020.  
      \[[SSRN](https://papers.ssrn.com/abstract=3708132)] \[[Published version](https://www.sciencedirect.com/science/article/pii/S0929119922000244?casa_token=0EkAu2H-J9MAAAAA:T3qQcfL0_K6Uu1v9mbxFNbzUjFYT54LN9-cu63amkpCJYq8ZLJ7aQfC_zcTS5qp0mhpsMjrAYg)]  

### WORKING PAPERS

10.  <span class="publication-title">**Capacity Disruptions and Pricing: Evidence from U.S. Airlines** - *Resubmission invited at American Economic Journal: Microeconomics*</span>  
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        We study pricing responses to shocks that diminish firms’ capital stock, by examining implications of the sudden grounding of the fuel-efficient Boeing 737 MAX on US carriers. Using novel fleet and flight data, we find significant variation in pricing responses among carriers based on their pre-grounding MAX utilization rates. Southwest, the most affected carrier, increased average fares by 1.7% (**\$4**) on its MAX-operated routes, which would have risen by 17% (**\$41**) had the MAX been used exclusively. Cost increases from using less fuel-efficient idle capacity do not fully explain these price hikes, and are attributed to tightened capacity constraints. The quarterly increase in carbon emissions due to the use of less fuel-efficient aircraft during the grounding was equivalent to those produced by 104,720 cars.  
    </details>
      with [Paula Navarro](https://sites.google.com/view/paulanavarro/home)  
      First version: May 2024.  
      \[[SSRN](https://papers.ssrn.com/abstract=4718902)]  

9.  <span class="publication-title">**AI-qualizing Science** - *Resubmission invited at Nature*</span>  
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        Scientific discovery remains highly concentrated among elite universities due to unequal access to infrastructure, expertise, and collaboration networks. We investigate whether artificial intelligence can mitigate these disparities by studying AlphaFold, a deep learning system awarded the 2024 Nobel Prize in Chemistry for its transformative impact on protein structure predictions. Using publication data from top journals and universities worldwide, we show that lower-ranked institutions increased their share of high-impact protein research by up to five percentage points within two years of AlphaFold’s public release. These gains are specific to protein domains and absent in non-protein fields or lower-tier journals. We further document enhanced research novelty, directional pivoting, and citation impact among lower-tier institutions, alongside reduced dependence on collaborations with top-ranked partners. By broadening participation in frontier protein science, AlphaFold exemplifies how open-access AI tools can disrupt entrenched hierarchies in research. This democratizing effect has far-reaching implications as similar AI systems emerge in other complex domains such as genomics, materials science, and climate modeling.  
    </details>
      with [Ludovic Phalippou](https://www.sbs.ox.ac.uk/about-us/people/ludovic-phalippou) and [Francois Bares](https://www.sbs.ox.ac.uk/about-us/people/francois-bares)  
      First version: August 2025.  
      \[[SSRN](https://papers.ssrn.com/abstract=5130373)] \[[bioRxiv](https://www.biorxiv.org/content/10.1101/2025.02.11.637417v1)]  

8.  <span class="publication-title">**War and Corporate Investment**</span> 
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        Geopolitical risks suppress corporate investment by creating uncertainty about future conditions. Armed conflicts represent an extreme form of geopolitical risk that goes beyond uncertainty by directly destroying facilities, displacing workers, and shutting operations. Using Russia’s 2022 invasion of Ukraine as a natural experiment, we examine how multinational firms respond to operational exposure to conflict. We construct a novel firm-level conflict exposure index that combines regional vulnerability to conflict with real-time military activity, weighted by each firm’s pre-invasion workforce distribution across Ukrainian regions. Firms with higher conflict exposure lost significant market value and reduced capital expenditures following the invasion, yet simultaneously increased R&D spending. This compositional shift contradicts standard models predicting uniform investment cuts under extreme uncertainty. U.S. firms cut capital spending more sharply but increased R&D more aggressively than non-U.S. counterparts facing identical conflict exposure. Our findings reveal that extreme geopolitical shocks trigger strategic reallocations from physical capital toward innovation rather than uniformly depressing investment, with effects propagating through firms’ operational networks.  
    </details>
      First version: October 2025.  
      \[[Current Version](files/Ukraine_Firm_Risk.pdf)] 

7.  <span class="publication-title">**Regulatory Reform and Opportunistic Insider Trading**</span> 
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        Following extensive attention from Congress, media, courts, and academia, the SEC in 2022 comprehensively reformed U.S. insider trading regulation to eliminate loopholes in Rule 10b5-1. We study how the reform affected corporate insiders’ opportunistic trading and abnormal returns. Linking 158,000 stock sales by executives to unique data on 10b5-1 plan adoption dates, we document substantial pre-reform abnormal returns for “loophole trades” including single-trade plans and trades executed shortly after plan adoption. Although the reform significantly curtailed loophole trades, abnormal returns did not decline, partly due to strategic substitution. The results highlight limits of legal design in constraining insiders’ trading profits.  
    </details>
      with [Hans Hvide](https://sites.google.com/site/hanshvide/home) and [Hedda Rytter Tveiten](https://www4.uib.no/finn-ansatte/Hedda.Rytter.Tveiten)  
      First version: October 2025.  
      \[[SSRN](https://papers.ssrn.com/abstract=5634530)] 

6.  <span class="publication-title">**Tariffs, Stablecoins, and the Demand for Dollars**</span> 
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        We document a significant relationship between the reciprocal tariffs announced by the US government on April 2, 2025, and investors’ demand for stablecoins. We find evidence for a dollar hoarding channel: as foreigners anticipate that tariffs will make it more expensive to acquire US dollars in future, they buy USD-pegged assets today. This channel grows in magnitude until the tariffs are delayed on April 9. Our findings suggest heterogeneity in investors’ responses to the tariffs: while there may be a flight away from the US dollar in aggregate, investors in higher tariff countries have relatively high demand for dollar stablecoins.  
    </details>
      with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)  
      First version: April 2025.  
      \[[Latest Version](files/Tariffs_and_stablecoins.pdf)]  

5.  <span class="publication-title">**Early Price Discovery in IPOs**</span>  
    <details class="publication-abstract">
      <summary style="color:seagreen">Abstract</summary>
      We study how investor feedback before bookbuilding influences IPO pricing and allocations. Using a novel dataset of investor-underwriter meetings and new airline route launches that reduce travel times as an exogenous source of variation facilitating these interactions, we find that precise, optimistic feedback narrows the price range and drives the offer price upward. Investors providing pre-bookbuilding feedback are more likely to bid and secure larger, more profitable allocations, supporting information revelation theories. Our findings shed light on the historically opaque role of early investor engagement in shaping IPO outcomes, with implications for capital markets design and regulation. 
    </details>
      with [Howard Jones](https://www.sbs.ox.ac.uk/about-us/people/howard-jones), and [Emmanuel Pezier](https://www.sbs.ox.ac.uk/about-us/people/emmanuel-pezier)  
    First version: May 2025.  
      \[[SSRN](https://papers.ssrn.com/abstract=5260016)]  

4.  <span class="publication-title">**Market Reactions to Gendered Speech Patterns** - *Under Review*</span>  
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        We analyze how gender-based sociolinguistic perceptions influence the credibility of corporate executives. Using audio recordings, we focus on uptalk (rising intonation) occurrence among executives during earnings calls. Uptalk by female, but not male, executives predicts lower earnings and prompts analysts to issue lower recommendations and earnings forecasts, although these do not fully reflect the signal. Bid-ask spreads widen when female executives speak and use uptalk. These findings suggest that uptalk is a female-typed characteristic signaling uncertainty. The #MeToo movement did not alter signaling value or market response of female uptalk, but led to more male uptalk eliciting favorable market responses. 
    </details>
      with [Alan Morrison](https://www.sbs.ox.ac.uk/about-us/people/alan-morrison), [Laura Fritsch](https://www.sbs.ox.ac.uk/about-us/people/laura-fritsch) and [Howard Jones](https://www.sbs.ox.ac.uk/about-us/people/howard-jones)  
      First version: July 2023.  
      \[[SSRN](https://papers.ssrn.com/abstract=4501479)]  
    <span style="color:seagreen">*Media Coverage:*</span> \[[Financial Times](https://www.ft.com/content/35282b5a-177b-4ac4-b22a-b39254ee6732)]  

3.  <span class="publication-title">**Equity Analysts Downgrade Stock Recommendations When Female CEOs Use Uptalk** - *Under Review*</span>  
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        Despite having similar performance to their male counterparts, women remain underrepresented in corporate leadership roles. In the US for example, only 6.6% of CEOs of Fortune 500 firms are women. One explanation is that female CEOs face more negative evaluations from investors and analysts 1-4, yet we know little about when and why this evaluative discount happens. Here we show that analysts and investors respond negatively when an incoming female CEO uses high levels of high-rising intonation ('uptalk') during her first earnings calls. Newly appointed male CEOs face no change in evaluations when they use 'uptalk'. This pattern that connects gender disparities in evaluative outcomes to 'uptalk' (a female-typed speech pattern), was uncovered by applying a novel voice analysis method to a large dataset comprising the original voice recordings of every earnings call surrounding CEO transitions in the US from 2011 to 2019. Our study demonstrates the general value of voice analysis in understanding why evaluations of social groups can remain decoupled from their realized performance and points to an understudied mechanism that maintains gender disparities in corporate leadership.
    </details>
      with [Aharon Mohliver](https://www.london.edu/faculty-and-research/faculty-profiles/c/cohen-mohliver-a) and [Laura Fritsch](https://www.sbs.ox.ac.uk/about-us/people/laura-fritsch)  
      First version: December 2023.  
      \[[SSRN](https://papers.ssrn.com/abstract=4634085)] 
    <span style="color:seagreen">*Media Coverage:*</span> \[[Financial Times](https://www.ft.com/content/35282b5a-177b-4ac4-b22a-b39254ee6732)]  

2.  <span class="publication-title">**Fintech Lending Under Austerity**</span>  
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        We document public welfare spending as an important growth driver of FinTech lending. Examining the massive austerity-led cuts to local welfare spending initiated by the UK government in 2010, we show that the gradual uneven rollback of the local welfare state since then is strongly associated with a rise in demand for peer-to-peer (P2P) consumer loans among affected areas, primarily in areas facing more banking and digital exclusion. P2P loans issued in austerity-affected areas are more expensive compared to those issued in unaffected areas, consistent with the P2P platform's risk pricing sensitivity to higher default rates in affected areas. Overall, our findings show that P2P lending, as an alternative means to household finance, can help smooth cuts in welfare transfers particularly among households in economically deprived areas.
    </details>
      with [Yan Alperovych](https://em-lyon.com/en/yan-alperovych/briefly) and [François Le Grand](https://francois-le-grand.com/)  
      Latest version: August 2022. First version: July 2022.  
      \[[SSRN](https://papers.ssrn.com/abstract=4169831)]  

1.  <span class="publication-title">**How does Mandatory Disclosure affect Firm Growth? Evidence from Firms that Lose their JOBS Exemptions** - R & R </span>  
    <details class="publication-abstract">
        <summary style="color:seagreen">Abstract</summary>
        U.S. firms which go public under the JOBS Act benefit from disclosure exemptions, but on average these last for only two years. We study the impact on the investments and growth opportunities of these firms when they move to mandatory disclosure. After losing their exemptions, firms raise less equity relative to debt and invest less in physical assets, innovation, and acquisitions. At the same time, they exhibit better allocation of equity to investments, better utilization of existing assets, and improvements in Tobin’s q. These findings suggest that disclosure-exempt firms prioritise investment, but those subject to stricter disclosure requirements make more efficient investment decisions. 
    </details>
      with [Howard Jones](https://www.sbs.ox.ac.uk/about-us/people/howard-jones)  
      Latest version: August 2022. First version: July 2022.  
      \[[SSRN](https://papers.ssrn.com/abstract=3845468)]  

### WORKS IN PROGRESS

1. <span class="publication-title">**Crypto Liquidity**</span>  
      with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)  

2. <span class="publication-title">**Bidding in the Gig Economy**</span>  
      with [Hans Hvide](https://sites.google.com/site/hanshvide) and [Steve Tadelis](https://faculty.haas.berkeley.edu/stadelis/)   

3. <span class="publication-title">**Crypto Regulation**</span>  
      with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)
